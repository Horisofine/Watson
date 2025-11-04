import { createAgent } from "langchain";
import { ChatOllama } from "@langchain/ollama";
import * as z from "zod";
import { weatherTool } from "./tools";
import { watsonPersonality } from "./prompt";
import { appendMemory, getConversationContext } from "./rag";

const remoteModel = new ChatOllama({
  model: process.env.OLLAMA_REMOTE_MODEL,
  baseUrl: process.env.OLLAMA_REMOTE_URL,
});

const watsonAgent = createAgent({
  model: remoteModel,
  tools: [weatherTool],
  description: "Dr. Watson assistant with tools and short-term recall.",
  responseFormat: z.object({
    weather: z.string().optional(),
    reply: z.string().describe("Watson's direct reply to the user"),
  }),
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

  const reply =
    result.structuredResponse?.reply ??
    result.output ??
    "I'm here, but I need a moment.";

  appendMemory(chatId, { role: "user", content: message, timestamp: Date.now() });
  appendMemory(chatId, { role: "assistant", content: reply, timestamp: Date.now() });

  return { text: reply, raw: result } satisfies AgentReply;
}
