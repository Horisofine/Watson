import { Langfuse } from "langfuse";

// Initialize Langfuse client
let langfuseClient: Langfuse | null = null;

export function getLangfuseClient(): Langfuse | null {
  // Only initialize if credentials are provided
  if (!process.env.LANGFUSE_PUB_KEY || !process.env.LANGFUSE_SEC_KEY) {
    console.warn("[METRICS] Langfuse credentials not configured. Metrics collection disabled.");
    return null;
  }

  if (!langfuseClient) {
    langfuseClient = new Langfuse({
      publicKey: process.env.LANGFUSE_PUB_KEY,
      secretKey: process.env.LANGFUSE_SEC_KEY,
      baseUrl: process.env.LANGFUSE_HOST || "http://localhost:3000",
    });

    console.log("[METRICS] Langfuse client initialized");
  }

  return langfuseClient;
}

/**
 * Check if Langfuse is configured and ready
 */
export function isLangfuseEnabled(): boolean {
  return !!(process.env.LANGFUSE_PUB_KEY && process.env.LANGFUSE_SEC_KEY);
}

/**
 * Create a Langfuse trace for a conversation
 */
export function createConversationTrace(chatId: number, userId: number) {
  const client = getLangfuseClient();

  if (!client) {
    return null;
  }

  return client.trace({
    id: `chat_${chatId}_${Date.now()}`,
    name: "watson_conversation",
    userId: userId.toString(),
    metadata: {
      chatId,
      userId,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Create a span for tracking specific operations
 */
export function createSpan(
  traceName: string,
  spanName: string,
  metadata?: Record<string, any>
) {
  const client = getLangfuseClient();

  if (!client) {
    return null;
  }

  const trace = client.trace({
    name: traceName,
    metadata,
  });

  return trace.span({
    name: spanName,
    metadata,
  });
}

/**
 * Track a custom event
 */
export async function trackEvent(
  name: string,
  metadata?: Record<string, any>,
  userId?: number
) {
  const client = getLangfuseClient();

  if (!client) {
    return;
  }

  client.event({
    name,
    metadata,
    userId: userId?.toString(),
  });

  await client.flushAsync();
}

/**
 * Shutdown Langfuse client gracefully
 */
export async function shutdownMetrics() {
  if (langfuseClient) {
    console.log("[METRICS] Flushing remaining metrics...");
    await langfuseClient.shutdownAsync();
    langfuseClient = null;
    console.log("[METRICS] Langfuse client shut down");
  }
}
