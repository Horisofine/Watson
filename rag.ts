type MemoryEntry = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

const conversationMemory = new Map<number, MemoryEntry[]>();

export function appendMemory(chatId: number, entry: MemoryEntry) {
  const history = conversationMemory.get(chatId) ?? [];
  history.push(entry);
  conversationMemory.set(chatId, history.slice(-20)); // simple sliding window
}

export function getConversationContext(chatId: number): string {
  const history = conversationMemory.get(chatId) ?? [];
  if (!history.length) return "";

  return history
    .map(
      (entry) =>
        `${new Date(entry.timestamp).toISOString()} [${entry.role}]: ${entry.content}`
    )
    .join("\n");
}
