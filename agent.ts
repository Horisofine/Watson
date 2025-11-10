import { BaseMessage, AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { StateGraph, END, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import * as z from "zod";
import { weatherTool, searchDocumentsTool, listFilesTool } from "./tools";
import { watsonPersonality } from "./prompt";
import { appendMemory, getConversationContext } from "./rag";

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
  };

  // Some Ollama models support a "think" parameter to control reasoning output
  // If the model doesn't support it, this will be ignored
  if (!showThinking) {
    config.think = false;
  }

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
  // Otherwise, we stop (reply to the user)
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

// Create the LangGraph workflow
function createWatsonGraph(showThinking: boolean = false) {
  const model = createOllamaModel(showThinking);

  // Bind tools to the model
  const tools = [weatherTool, searchDocumentsTool, listFilesTool];
  const modelWithTools = model.bindTools(tools);

  // Define a new graph
  const workflow = new StateGraph(AgentState)
    .addNode("agent", async (state) => callModel(state, { model: modelWithTools }))
    .addNode("tools", new ToolNode(tools))
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

  const context = getConversationContext(chatId);
  const contextBlurb = context
    ? `\n\nRecent conversation log:\n${context}`
    : "";

  console.log(`[AGENT] Context: ${context ? context.split("\n").length + " previous messages" : "no history"}`);
  console.log(`[AGENT] Invoking Watson graph with tools: weather, search_my_documents, list_my_files`);

  const graph = createWatsonGraph(showThinking);
  const startTime = Date.now();

  // Prepare initial messages
  const initialMessages = [
    new SystemMessage(watsonPersonality + contextBlurb),
    new HumanMessage(message),
  ];

  // Invoke the graph
  const result = await graph.invoke(
    {
      messages: initialMessages,
      userId: chatId,
    },
    {
      configurable: { thread_id: `chat_${chatId}` },
      metadata: { userId: chatId },
    }
  );

  const elapsed = Date.now() - startTime;

  // Get the final message from the result
  const finalMessage = result.messages[result.messages.length - 1];
  const response = String(finalMessage.content);

  console.log(`[AGENT] Response generated in ${elapsed}ms (${response.length} chars)`);
  console.log(`[AGENT] Total messages in result: ${result.messages.length}`);

  // Log tool calls that occurred
  const toolCalls = result.messages.filter((m: any) => m.tool_calls && m.tool_calls.length > 0);
  if (toolCalls.length > 0) {
    console.log(`[AGENT] Tool call messages: ${toolCalls.length}`);
    toolCalls.forEach((call: any, idx: number) => {
      const tools = call.tool_calls || [];
      tools.forEach((t: any) => {
        console.log(`[AGENT]   ${idx + 1}. ${t.name || 'unknown'}`);
      });
    });
  } else {
    console.log(`[AGENT] No tool calls were made`);
  }

  console.log(`[AGENT] === RAW LLM OUTPUT ===`);
  console.log(response);
  console.log(`[AGENT] === END RAW OUTPUT ===`);

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
