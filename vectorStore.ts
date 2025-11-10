import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { createEmbeddings } from "./embeddings";
import type { FileMetadata } from "./fileHandler";
import type { Embeddings } from "@langchain/core/embeddings";

const VECTOR_STORE_PATH = "./data/vectors.json";

interface VectorDocument {
  content: string;
  embedding: number[];
  metadata: DocumentMetadata;
}

class SimpleVectorStore {
  private documents: VectorDocument[] = [];
  private embeddings: Embeddings;

  constructor(embeddings: Embeddings) {
    this.embeddings = embeddings;
  }

  async addDocuments(docs: Document<DocumentMetadata>[]): Promise<void> {
    const texts = docs.map((d) => d.pageContent);
    const embeddings = await this.embeddings.embedDocuments(texts);

    for (let i = 0; i < docs.length; i++) {
      this.documents.push({
        content: docs[i].pageContent,
        embedding: embeddings[i],
        metadata: docs[i].metadata,
      });
    }
  }

  async similaritySearch(
    query: string,
    k: number
  ): Promise<Document<DocumentMetadata>[]> {
    const queryEmbedding = await this.embeddings.embedQuery(query);

    // Calculate cosine similarity
    const similarities = this.documents.map((doc, index) => ({
      index,
      similarity: this.cosineSimilarity(queryEmbedding, doc.embedding),
    }));

    // Sort by similarity (descending)
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Return top k results
    return similarities.slice(0, k).map((s) => {
      const doc = this.documents[s.index];
      return new Document({
        pageContent: doc.content,
        metadata: doc.metadata,
      });
    });
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  getDocuments(): VectorDocument[] {
    return this.documents;
  }

  setDocuments(docs: VectorDocument[]): void {
    this.documents = docs;
  }
}

let vectorStoreInstance: SimpleVectorStore | null = null;

export interface DocumentMetadata extends FileMetadata {
  chunkIndex: number;
  totalChunks: number;
}

/**
 * Initializes or retrieves the singleton vector store instance.
 */
export async function getVectorStore(): Promise<SimpleVectorStore> {
  if (vectorStoreInstance) {
    return vectorStoreInstance;
  }

  const embeddings = createEmbeddings();
  vectorStoreInstance = new SimpleVectorStore(embeddings);

  // Try to load from disk
  try {
    const file = Bun.file(VECTOR_STORE_PATH);
    if (await file.exists()) {
      const data = await file.json();
      vectorStoreInstance.setDocuments(data.documents || []);
      console.log(
        `Loaded ${data.documents?.length || 0} document chunks from disk`
      );
    } else {
      console.log("Initialized new vector store");
    }
  } catch (error) {
    console.warn("Could not load vector store from disk:", error);
    console.log("Starting with empty vector store");
  }

  return vectorStoreInstance;
}

/**
 * Processes a file and adds its chunks to the vector store.
 */
export async function addDocumentToVectorStore(
  text: string,
  metadata: FileMetadata
): Promise<number> {
  console.log(`[VECTOR STORE] Adding document to vector store: ${metadata.filename}`);
  console.log(`[VECTOR STORE] Text length: ${text.length} characters`);

  const vectorStore = await getVectorStore();

  // Split text into chunks
  console.log(`[VECTOR STORE] Splitting text into chunks...`);
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });

  const chunks = await textSplitter.splitText(text);
  console.log(`[VECTOR STORE] Created ${chunks.length} chunks`);

  // Create documents with metadata
  const documents: Document<DocumentMetadata>[] = chunks.map(
    (chunk, index) => {
      return new Document({
        pageContent: chunk,
        metadata: {
          ...metadata,
          chunkIndex: index,
          totalChunks: chunks.length,
        },
      });
    }
  );

  // Add to vector store
  console.log(`[VECTOR STORE] Generating embeddings for ${chunks.length} chunks...`);
  const embeddingStart = Date.now();
  await vectorStore.addDocuments(documents);
  const embeddingTime = Date.now() - embeddingStart;
  console.log(`[VECTOR STORE] Embeddings generated in ${embeddingTime}ms (avg ${(embeddingTime / chunks.length).toFixed(0)}ms per chunk)`);

  // Persist to disk
  await persistVectorStore();

  console.log(
    `[VECTOR STORE] ✓ Added ${chunks.length} chunks from ${metadata.filename} to vector store`
  );

  return chunks.length;
}

/**
 * Searches the vector store for documents relevant to a query,
 * filtered by user ID.
 */
export async function searchDocuments(
  query: string,
  userId: number,
  numResults: number = 3
): Promise<Document<DocumentMetadata>[]> {
  console.log(`[VECTOR STORE] Searching documents for user ${userId}`);
  console.log(`[VECTOR STORE] Query: "${query}"`);

  const vectorStore = await getVectorStore();

  // Search with similarity
  console.log(`[VECTOR STORE] Performing similarity search (requesting ${numResults * 5} results to filter)`);
  const searchStart = Date.now();
  const allResults = await vectorStore.similaritySearch(query, numResults * 5); // Get more results to filter
  const searchTime = Date.now() - searchStart;

  // Filter by userId and limit to requested number
  const userResults = allResults
    .filter((doc) => doc.metadata.userId === userId)
    .slice(0, numResults);

  console.log(`[VECTOR STORE] Search complete in ${searchTime}ms`);
  console.log(`[VECTOR STORE] Found ${allResults.length} total results, ${userResults.length} for user ${userId}`);

  if (userResults.length > 0) {
    console.log(`[VECTOR STORE] Top result from: ${userResults[0].metadata.filename}`);
  }

  return userResults;
}

/**
 * Lists all documents for a specific user.
 */
export async function listUserDocuments(userId: number): Promise<string[]> {
  const vectorStore = await getVectorStore();
  const documents = vectorStore.getDocuments();

  // Extract unique filenames for this user
  const filenames = new Set<string>();
  for (const doc of documents) {
    if (doc.metadata?.userId === userId && doc.metadata?.filename) {
      filenames.add(doc.metadata.filename);
    }
  }

  return Array.from(filenames);
}

/**
 * Removes all chunks for a specific file from the vector store.
 */
export async function removeDocumentFromVectorStore(
  userId: number,
  filename: string
): Promise<number> {
  const vectorStore = await getVectorStore();
  const documents = vectorStore.getDocuments();

  // Filter out chunks matching the file
  const filteredDocuments = documents.filter(
    (doc) =>
      !(doc.metadata?.userId === userId && doc.metadata?.filename === filename)
  );

  const removedCount = documents.length - filteredDocuments.length;

  // Update the vector store
  vectorStore.setDocuments(filteredDocuments);

  // Persist to disk
  await persistVectorStore();

  console.log(
    `Removed ${removedCount} chunks for ${filename} from vector store`
  );

  return removedCount;
}

/**
 * Persists the vector store to disk as JSON.
 */
async function persistVectorStore(): Promise<void> {
  if (!vectorStoreInstance) {
    return;
  }

  try {
    const documents = vectorStoreInstance.getDocuments();
    const data = {
      documents,
      timestamp: Date.now(),
    };

    await Bun.write(VECTOR_STORE_PATH, JSON.stringify(data, null, 2));
    console.log(`Persisted vector store with ${documents.length} document chunks`);
  } catch (error) {
    console.error("Failed to persist vector store:", error);
  }
}

/**
 * Gets statistics about the vector store.
 */
export async function getVectorStoreStats(): Promise<{
  totalVectors: number;
  uniqueUsers: Set<number>;
  uniqueFiles: Set<string>;
}> {
  const vectorStore = await getVectorStore();
  const documents = vectorStore.getDocuments();

  const uniqueUsers = new Set<number>();
  const uniqueFiles = new Set<string>();

  for (const doc of documents) {
    if (doc.metadata?.userId) {
      uniqueUsers.add(doc.metadata.userId);
    }
    if (doc.metadata?.filename) {
      uniqueFiles.add(doc.metadata.filename);
    }
  }

  return {
    totalVectors: documents.length,
    uniqueUsers,
    uniqueFiles,
  };
}
