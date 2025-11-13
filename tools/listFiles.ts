import { tool } from "langchain";
import * as z from "zod";
import { listUserDocuments } from "../vectorStore";

/**
 * Tool for listing user's uploaded files.
 * Watson can use this when the user asks what files they have uploaded.
 */
export const listFilesTool = tool(
  async (input, config) => {
    console.log(`\n[TOOL: list_my_files] Invoked`);

    // Extract userId from config metadata
    const userId = config?.metadata?.userId as number | undefined;

    if (!userId) {
      console.log(`[TOOL: list_my_files] ERROR: No userId in config`);
      return "Error: User ID not available for listing files.";
    }

    console.log(`[TOOL: list_my_files] User: ${userId}`);

    try {
      const files = await listUserDocuments(userId);

      if (files.length === 0) {
        console.log(`[TOOL: list_my_files] No files found for user ${userId}`);
        return "You haven't uploaded any files yet.";
      }

      console.log(`[TOOL: list_my_files] ✓ Found ${files.length} files`);
      const fileList = files.map((f, i) => `${i + 1}. ${f}`).join("\n");
      return `You have ${files.length} uploaded file(s):\n${fileList}`;
    } catch (error) {
      console.error(`[TOOL: list_my_files] ✗ ERROR:`, error);
      return `Error listing files: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "list_my_files",
    description:
      "IMMEDIATELY list all uploaded files. Use this tool RIGHT NOW whenever the user asks: 'what files do I have', 'show my files', 'list my documents', 'what did I upload', or ANY question about which files they have. DON'T respond without calling this tool first.",
    schema: z.object({}), // No parameters needed
  }
);
