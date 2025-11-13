import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

type MemoryEntry = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

const MAX_MEMORY_SIZE = 50; // Increased from 20 to 50 messages
const MEMORY_FILE_PATH = join(process.cwd(), "data", "conversations.json");

const conversationMemory = new Map<number, MemoryEntry[]>();

/**
 * Load conversation memory from disk on startup
 */
export function loadMemoryFromDisk() {
  try {
    if (existsSync(MEMORY_FILE_PATH)) {
      const data = readFileSync(MEMORY_FILE_PATH, "utf-8");
      const parsed = JSON.parse(data);

      // Reconstruct Map from serialized object
      for (const [chatId, messages] of Object.entries(parsed)) {
        conversationMemory.set(Number(chatId), messages as MemoryEntry[]);
      }

      const totalChats = conversationMemory.size;
      const totalMessages = Array.from(conversationMemory.values()).reduce(
        (sum, msgs) => sum + msgs.length,
        0
      );

      console.log(`[MEMORY] Loaded ${totalMessages} messages across ${totalChats} conversations from disk`);
    } else {
      console.log("[MEMORY] No existing memory file found, starting fresh");
    }
  } catch (error) {
    console.error("[MEMORY] Failed to load memory from disk:", error);
  }
}

/**
 * Save conversation memory to disk
 */
function saveMemoryToDisk() {
  try {
    // Ensure data directory exists
    const dataDir = join(process.cwd(), "data");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Convert Map to plain object for JSON serialization
    const memoryObject = Object.fromEntries(conversationMemory.entries());

    writeFileSync(MEMORY_FILE_PATH, JSON.stringify(memoryObject, null, 2), "utf-8");
    console.log(`[MEMORY] Saved conversations to disk`);
  } catch (error) {
    console.error("[MEMORY] Failed to save memory to disk:", error);
  }
}

export function appendMemory(chatId: number, entry: MemoryEntry) {
  const history = conversationMemory.get(chatId) ?? [];
  history.push(entry);
  conversationMemory.set(chatId, history.slice(-MAX_MEMORY_SIZE)); // sliding window

  // Save to disk after each update
  saveMemoryToDisk();
}

/**
 * Get conversation context as an array of BaseMessage objects
 * This is the proper way to pass conversation history to LangChain/LangGraph
 */
export function getConversationContext(chatId: number): BaseMessage[] {
  const history = conversationMemory.get(chatId) ?? [];
  if (!history.length) return [];

  return history.map((entry) =>
    entry.role === "user"
      ? new HumanMessage(entry.content)
      : new AIMessage(entry.content)
  );
}

/**
 * Get raw memory entries (for debugging/stats)
 */
export function getRawMemory(chatId: number): MemoryEntry[] {
  return conversationMemory.get(chatId) ?? [];
}

/**
 * Clear memory for a specific chat
 */
export function clearMemory(chatId: number) {
  conversationMemory.delete(chatId);
  saveMemoryToDisk();
  console.log(`[MEMORY] Cleared conversation history for chat ${chatId}`);
}

/**
 * Get memory stats
 */
export function getMemoryStats(chatId: number) {
  const history = conversationMemory.get(chatId) ?? [];
  return {
    messageCount: history.length,
    maxSize: MAX_MEMORY_SIZE,
    utilizationPercent: (history.length / MAX_MEMORY_SIZE) * 100,
  };
}
