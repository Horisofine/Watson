import { OllamaEmbeddings } from "@langchain/ollama";

/**
 * Centralized embedding configuration using Ollama.
 * Uses nomic-embed-text model by default (lightweight and effective).
 * Ensure the model is pulled: ollama pull nomic-embed-text
 */
export function createEmbeddings() {
  const embeddingModel =
    process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
  const baseUrl = process.env.OLLAMA_REMOTE_URL;

  if (!baseUrl) {
    throw new Error("OLLAMA_REMOTE_URL not configured");
  }

  return new OllamaEmbeddings({
    model: embeddingModel,
    baseUrl,
  });
}
