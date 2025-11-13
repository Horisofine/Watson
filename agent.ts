import { BaseMessage, AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { StateGraph, END, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import * as z from "zod";
import {
  weatherTool,
  searchDocumentsTool,
  listFilesTool,
  createEventTool,
  listEventsTool,
  deleteEventTool
} from "./tools";
import { watsonPersonality } from "./prompt";
import { appendMemory, getConversationContext } from "./rag";
import { trackError } from "./services/errorTracking";

// Simple token estimation (roughly 4 characters per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Define the state schema for our agent graph
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  userId: Annotation<number>({
    reducer: (x, y) => y ?? x,
  }),
});

// Base configuration for ChatOllama
function createOllamaModel(showThinking: boolean = false) {
  const config: any = {
    model: process.env.OLLAMA_REMOTE_MODEL,
    baseUrl: process.env.OLLAMA_REMOTE_URL,
    numPredict: -1, // No limit on tokens
    think: showThinking, // Enable/disable thinking mode in Ollama
  };

  return new ChatOllama(config);
}

// Define the function that determines whether to continue or not
function shouldContinue(state: typeof AgentState.State): "tools" | typeof END {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // If the LLM makes a tool call, then we route to the "tools" node
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    console.log(`[AGENT] Tool calls detected: ${lastMessage.tool_calls.length} tool(s)`);
    return "tools";
  }

  // No tool calls means we're done - Watson has provided final response
  console.log(`[AGENT] No tool calls, ending conversation`);
  return END;
}

// Define the function that calls the model
async function callModel(state: typeof AgentState.State, config: { model: ChatOllama }) {
  const messages = state.messages;
  console.log(`[AGENT] Calling model with ${messages.length} messages`);
  const response = await config.model.invoke(messages);
  console.log(`[AGENT] Model response received (${String(response.content).length} chars)`);

  // Return command instructs graph to update state
  return { messages: [response] };
}

// Tool execution node
async function executeTools(state: typeof AgentState.State) {
  const tools = [
    weatherTool,
    searchDocumentsTool,
    listFilesTool,
    createEventTool,
    listEventsTool,
    deleteEventTool
  ];
  const toolNode = new ToolNode(tools);
  return await toolNode.invoke(state);
}

// Create the LangGraph workflow
function createWatsonGraph(showThinking: boolean = false) {
  const model = createOllamaModel(showThinking);

  // Bind tools to the model
  const tools = [
    weatherTool,
    searchDocumentsTool,
    listFilesTool,
    createEventTool,
    listEventsTool,
    deleteEventTool
  ];
  const modelWithTools = model.bindTools(tools);

  // Define a new graph
  const workflow = new StateGraph(AgentState)
    .addNode("agent", async (state) => callModel(state, { model: modelWithTools }))
    .addNode("tools", executeTools)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

  return workflow.compile();
}

export type AgentReply = {
  text: string;
  raw: any;
};

export async function runWatsonAgent(
  chatId: number,
  message: string,
  showThinking: boolean = false
) {
  console.log(`[AGENT] Processing message for chat ${chatId}`);
  console.log(`[AGENT] Show thinking mode: ${showThinking}`);

  const conversationHistory = getConversationContext(chatId);

  console.log(`[AGENT] Context: ${conversationHistory.length} previous messages`);
  console.log(`[AGENT] Invoking Watson graph with tools: weather, search_my_documents, list_my_files`);

  const graph = createWatsonGraph(showThinking);
  const startTime = Date.now();

  // Prepare initial messages - proper message history instead of string in system prompt
  const initialMessages = [
    new SystemMessage(watsonPersonality),
    ...conversationHistory, // Include previous conversation as actual message objects
    new HumanMessage(message),
  ];

  // Create Langfuse trace for this conversation
  const { getLangfuseClient } = await import("./services/metrics");
  const langfuseClient = getLangfuseClient();
  let trace = null;
  let generation = null;

  if (langfuseClient) {
    trace = langfuseClient.trace({
      id: `chat_${chatId}_${Date.now()}`,
      name: "watson_conversation",
      userId: chatId.toString(),
      sessionId: `chat_${chatId}`,
      metadata: {
        showThinking,
        contextMessageCount: conversationHistory.length,
        messagePreview: message.substring(0, 100),
      },
    });

    generation = trace.generation({
      name: "llm_call",
      model: process.env.OLLAMA_REMOTE_MODEL || "unknown",
      input: message,
      metadata: {
        contextMessages: conversationHistory.length,
      },
    });

    console.log(`[METRICS] Langfuse trace created: chat_${chatId}_${Date.now()}`);
  }

  // Invoke the graph
  let result;
  try {
    result = await graph.invoke(
      {
        messages: initialMessages,
        userId: chatId,
      },
      {
        configurable: { thread_id: `chat_${chatId}` },
        metadata: { userId: chatId },
      }
    );
  } catch (error: any) {
    // End generation with error
    if (generation) {
      generation.end({
        level: "ERROR",
        statusMessage: error.message,
      });
    }

    // Track LLM errors
    await trackError({
      errorType: "LLM_INVOCATION_ERROR",
      errorMessage: error.message,
      stackTrace: error.stack,
      userId: chatId,
      chatId,
      metadata: {
        message: message.substring(0, 100),
      },
    });
    throw error;
  }

  const elapsed = Date.now() - startTime;

  // Get the final response from the last AI message
  const finalMessage = result.messages[result.messages.length - 1];
  const response = String(finalMessage.content);

  console.log(`[AGENT] Response generated in ${elapsed}ms (${response.length} chars)`);
  console.log(`[AGENT] Total messages in result: ${result.messages.length}`);

  // Log tool calls that occurred
  const toolCalls = result.messages.filter((m: any) => m.tool_calls && m.tool_calls.length > 0);
  const toolCallsList: string[] = [];
  if (toolCalls.length > 0) {
    console.log(`[AGENT] Tool call messages: ${toolCalls.length}`);
    toolCalls.forEach((call: any, idx: number) => {
      const tools = call.tool_calls || [];
      tools.forEach((t: any) => {
        const toolName = t.name || 'unknown';
        console.log(`[AGENT]   ${idx + 1}. ${toolName}`);
        toolCallsList.push(toolName);
      });
    });
  } else {
    console.log(`[AGENT] No tool calls were made`);
  }

  console.log(`[AGENT] === RAW LLM OUTPUT ===`);
  console.log(response);
  console.log(`[AGENT] === END RAW OUTPUT ===`);

  // End Langfuse generation with results including token counts
  if (generation) {
    // Calculate full input (system prompt + all conversation messages)
    const allInputText = initialMessages.map(m => String(m.content)).join("\n");
    const inputTokens = estimateTokens(allInputText);
    const outputTokens = estimateTokens(response);
    const totalTokens = inputTokens + outputTokens;

    generation.end({
      output: response,
      usage: {
        input: inputTokens,
        output: outputTokens,
        total: totalTokens,
      },
      metadata: {
        durationMs: elapsed,
        totalMessages: result.messages.length,
        toolCalls: toolCallsList,
        responseLength: response.length,
        estimatedTokens: true, // Flag to indicate these are estimates
      },
    });
    console.log(`[METRICS] Generation ended. Duration: ${elapsed}ms, Tokens: ${totalTokens} (${inputTokens} in / ${outputTokens} out), Tools: ${toolCallsList.join(', ') || 'none'}`);
  }

  // Flush Langfuse trace
  if (langfuseClient) {
    await langfuseClient.flushAsync();
    console.log(`[METRICS] Langfuse trace flushed`);
  }

  appendMemory(chatId, {
    role: "user",
    content: message,
    timestamp: Date.now(),
  });
  appendMemory(chatId, {
    role: "assistant",
    content: response,
    timestamp: Date.now(),
  });

  console.log(`[AGENT] Memory updated for chat ${chatId}`);

  return {
    text: response,
    raw: result,
  } satisfies AgentReply;
}
