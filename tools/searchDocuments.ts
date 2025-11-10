import { tool } from "langchain";
import * as z from "zod";
import { searchDocuments } from "../vectorStore";

/**
 * Tool for searching through user's uploaded documents using RAG.
 * Watson can use this when the user asks about their files or needs
 * information from uploaded PDFs/text files.
 */
export const searchDocumentsTool = tool(
  async (input, config) => {
    console.log(`\n[TOOL: search_my_documents] Invoked with query: "${input.query}"`);

    // Extract userId from config metadata
    const userId = config?.metadata?.userId as number | undefined;

    if (!userId) {
      console.log(`[TOOL: search_my_documents] ERROR: No userId in config`);
      return "Error: User ID not available for searching documents.";
    }

    console.log(`[TOOL: search_my_documents] User: ${userId}, Results requested: ${input.numResults || 3}`);

    try {
      const results = await searchDocuments(
        input.query,
        userId,
        input.numResults || 3
      );

      if (results.length === 0) {
        console.log(`[TOOL: search_my_documents] No results found for user ${userId}`);
        return "No relevant documents found. The user may not have uploaded any files yet, or the search query didn't match any content.";
      }

      // Format results for Watson
      const formattedResults = results
        .map((doc, index) => {
          const meta = doc.metadata;
          const uploadDate = new Date(meta.uploadDate).toLocaleDateString();
          return [
            `[Document ${index + 1}: ${meta.filename} (uploaded ${uploadDate})]`,
            doc.pageContent.trim(),
            `[Chunk ${meta.chunkIndex + 1} of ${meta.totalChunks}]`,
          ].join("\n");
        })
        .join("\n\n---\n\n");

      console.log(`[TOOL: search_my_documents] ✓ Returning ${results.length} results (${formattedResults.length} chars)`);
      return `Found ${results.length} relevant section(s):\n\n${formattedResults}`;
    } catch (error) {
      console.error(`[TOOL: search_my_documents] ✗ ERROR:`, error);
      return `Error searching documents: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "search_my_documents",
    description:
      "Search through the CONTENT of documents the user has uploaded. Use this tool when the user asks: 'what does the file contain', 'what's in my document', 'tell me about the file', 'what does it say', or any question about the CONTENT/TEXT inside their uploaded files. You MUST call this tool immediately if you say you'll check a file.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "The search query to find relevant document sections. Use natural language describing what information you're looking for."
        ),
      numResults: z
        .number()
        .optional()
        .describe("Number of relevant sections to return (default: 3)"),
    }),
  }
);
