import { BaseMessage, createAgent } from "langchain";
import { ChatOllama } from "@langchain/ollama";
import * as z from "zod";
import { weatherTool } from "./tools";
import { watsonPersonality } from "./prompt";
import { appendMemory, getConversationContext } from "./rag";
import { late } from "zod/v3";

function lastItem<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

const remoteModel = new ChatOllama({
  model: process.env.OLLAMA_REMOTE_MODEL,
  baseUrl: process.env.OLLAMA_REMOTE_URL,
});

const watsonAgent = createAgent({
  model: remoteModel,
  tools: [weatherTool],
  description: "Dr. Watson assistant with tools and short-term recall.",
});

export type AgentReply = {
  text: string;
  raw: Awaited<ReturnType<typeof watsonAgent.invoke>>;
};

export async function runWatsonAgent(chatId: number, message: string) {
  const context = getConversationContext(chatId);
  const contextBlurb = context
    ? `\n\nRecent conversation log:\n${context}`
    : "";

  const result = await watsonAgent.invoke({
    messages: [
      { role: "system", content: watsonPersonality + contextBlurb },
      { role: "user", content: message },
    ],
  });

  const response = String(lastItem(result.messages)?.content);

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

  return {
    text: response,
    raw: result,
  } satisfies AgentReply;
}
