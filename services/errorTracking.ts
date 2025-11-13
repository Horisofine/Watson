import { Langfuse } from "langfuse";

// Initialize Langfuse client for error tracking
let langfuseClient: Langfuse | null = null;

function getLangfuseClient(): Langfuse | null {
  // Only initialize if credentials are provided
  if (!process.env.LANGFUSE_PUB_KEY || !process.env.LANGFUSE_SEC_KEY) {
    return null;
  }

  if (!langfuseClient) {
    langfuseClient = new Langfuse({
      publicKey: process.env.LANGFUSE_PUB_KEY,
      secretKey: process.env.LANGFUSE_SEC_KEY,
      baseUrl: process.env.LANGFUSE_HOST || "http://localhost:3000",
    });
  }

  return langfuseClient;
}

export interface ErrorContext {
  userId?: number;
  chatId?: number;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  metadata?: Record<string, any>;
}

/**
 * Track an error with Langfuse
 */
export async function trackError(context: ErrorContext) {
  const client = getLangfuseClient();

  if (!client) {
    // Fallback to console logging if Langfuse not configured
    console.error(`[ERROR TRACKING] ${context.errorType}: ${context.errorMessage}`);
    if (context.stackTrace) {
      console.error(`[ERROR TRACKING] Stack trace:`, context.stackTrace);
    }
    return;
  }

  try {
    // Create an event in Langfuse for error tracking
    client.event({
      name: "error",
      metadata: {
        errorType: context.errorType,
        errorMessage: context.errorMessage,
        stackTrace: context.stackTrace,
        userId: context.userId,
        chatId: context.chatId,
        ...context.metadata,
      },
      level: "ERROR",
      userId: context.userId?.toString(),
    });

    // Flush events to ensure they're sent
    await client.flushAsync();
  } catch (e) {
    // Don't let error tracking errors crash the app
    console.error(`[ERROR TRACKING] Failed to track error:`, e);
  }
}

/**
 * Track a warning with Langfuse
 */
export async function trackWarning(message: string, metadata?: Record<string, any>) {
  const client = getLangfuseClient();

  if (!client) {
    console.warn(`[WARNING] ${message}`, metadata);
    return;
  }

  try {
    client.event({
      name: "warning",
      metadata: {
        message,
        ...metadata,
      },
      level: "WARNING",
    });

    await client.flushAsync();
  } catch (e) {
    console.error(`[ERROR TRACKING] Failed to track warning:`, e);
  }
}

/**
 * Track performance metrics
 */
export async function trackPerformance(
  operation: string,
  durationMs: number,
  metadata?: Record<string, any>
) {
  const client = getLangfuseClient();

  if (!client) {
    console.log(`[PERFORMANCE] ${operation}: ${durationMs}ms`, metadata);
    return;
  }

  try {
    client.event({
      name: "performance",
      metadata: {
        operation,
        durationMs,
        ...metadata,
      },
      level: "DEFAULT",
    });

    await client.flushAsync();
  } catch (e) {
    console.error(`[ERROR TRACKING] Failed to track performance:`, e);
  }
}

/**
 * Shutdown Langfuse client gracefully
 */
export async function shutdownErrorTracking() {
  if (langfuseClient) {
    await langfuseClient.shutdownAsync();
    langfuseClient = null;
  }
}
