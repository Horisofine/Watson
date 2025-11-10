import { Bot, GrammyError, HttpError } from "grammy";
import { hydrateFiles } from "@grammyjs/files";
import { runWatsonAgent } from "./agent";
import {
  downloadAndSaveFile,
  extractTextFromFile,
  listUserFiles,
  deleteUserFile,
} from "./fileHandler";
import {
  addDocumentToVectorStore,
  listUserDocuments,
  removeDocumentFromVectorStore,
} from "./vectorStore";

type ThinkingPreference = Map<number, boolean>;

export function createTelegramBot(token: string) {
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN missing");
  }

  const bot = new Bot(token);

  // Enable file downloading
  bot.api.config.use(hydrateFiles(bot.token));

  const thinkingPref: ThinkingPreference = new Map();

  bot.api.setMyCommands([
    { command: "showthinking", description: "Show the LLM's chain-of-thought" },
    { command: "hidethinking", description: "Hide the LLM's chain-of-thought" },
    {
      command: "contextsize",
      description: "Show current buffered context tokens estimate",
    },
    { command: "listfiles", description: "List your uploaded documents" },
    { command: "deletefile", description: "Delete an uploaded document" },
  ]);

  bot.command("showthinking", async (ctx) => {
    thinkingPref.set(ctx.chat.id, true);
    await ctx.reply("🧠 I'll include thinking steps from now on.");
  });

  bot.command("hidethinking", async (ctx) => {
    thinkingPref.set(ctx.chat.id, false);
    await ctx.reply("🧠 I'll keep the thinking private.");
  });

  bot.command("contextsize", async (ctx) => {
    // Placeholder: RAG/memory roadmap will surface actual token counts.
    await ctx.reply("Context buffer: ~20 turns persisted in memory.");
  });

  bot.command("listfiles", async (ctx) => {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        return ctx.reply("Could not identify user.");
      }

      const files = await listUserDocuments(userId);

      if (files.length === 0) {
        return ctx.reply(
          "You haven't uploaded any documents yet. Send me a PDF or text file to get started."
        );
      }

      const fileList = files.map((f, i) => `${i + 1}. ${f}`).join("\n");
      await ctx.reply(`Your uploaded documents:\n\n${fileList}`);
    } catch (error) {
      console.error("Error listing files:", error);
      await ctx.reply("Sorry, I couldn't list your files right now.");
    }
  });

  bot.command("deletefile", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return ctx.reply("Could not identify user.");
    }

    const filename = ctx.message?.text?.split(" ").slice(1).join(" ").trim();

    if (!filename) {
      return ctx.reply(
        "Please specify a filename. Usage: /deletefile <filename>"
      );
    }

    try {
      // Remove from vector store
      const chunksRemoved = await removeDocumentFromVectorStore(userId, filename);

      // Delete physical file
      const fileDeleted = await deleteUserFile(userId, filename);

      if (chunksRemoved > 0 || fileDeleted) {
        await ctx.reply(`Deleted "${filename}" (${chunksRemoved} chunks removed).`);
      } else {
        await ctx.reply(`Could not find "${filename}".`);
      }
    } catch (error) {
      console.error("Error deleting file:", error);
      await ctx.reply("Sorry, I couldn't delete that file.");
    }
  });

  // Handle document uploads (PDFs and text files)
  bot.on("message:document", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;

    console.log(`\n[DOCUMENT UPLOAD] User ${userId} (chat ${chatId}) uploading file`);

    if (!userId) {
      console.log("[DOCUMENT UPLOAD] ERROR: Could not identify user");
      return ctx.reply("Could not identify user.");
    }

    const document = ctx.message.document;
    const filename = document.file_name || "unknown";
    const fileExt = filename.split(".").pop()?.toLowerCase();

    console.log(`[DOCUMENT UPLOAD] Filename: ${filename}, Extension: ${fileExt}, Size: ${document.file_size} bytes`);

    // Validate file type
    if (!fileExt || !["pdf", "txt", "md", "log"].includes(fileExt)) {
      console.log(`[DOCUMENT UPLOAD] ERROR: Unsupported file type: ${fileExt}`);
      return ctx.reply(
        "Sorry, I only support PDF and text files (.txt, .md, .log) at the moment."
      );
    }

    // Check file size (20MB limit for bot API)
    const fileSizeMB = document.file_size ? document.file_size / (1024 * 1024) : 0;
    if (fileSizeMB > 20) {
      console.log(`[DOCUMENT UPLOAD] ERROR: File too large: ${fileSizeMB.toFixed(1)}MB`);
      return ctx.reply(
        `File is too large (${fileSizeMB.toFixed(1)}MB). Maximum size is 20MB.`
      );
    }

    try {
      console.log(`[DOCUMENT UPLOAD] Step 1: Notifying user and starting download`);
      await ctx.reply(`Receiving "${filename}"...`);

      // Download file
      console.log(`[DOCUMENT UPLOAD] Step 2: Downloading file from Telegram`);
      const file = await ctx.getFile();
      const metadata = await downloadAndSaveFile(file, userId, chatId);
      console.log(`[DOCUMENT UPLOAD] File downloaded to: ${metadata.filePath}`);

      await ctx.reply("Extracting text...");

      // Extract text
      console.log(`[DOCUMENT UPLOAD] Step 3: Extracting text from ${metadata.fileType} file`);
      const text = await extractTextFromFile(metadata);
      console.log(`[DOCUMENT UPLOAD] Extracted ${text.length} characters of text`);

      await ctx.reply("Processing and indexing...");

      // Add to vector store
      console.log(`[DOCUMENT UPLOAD] Step 4: Chunking and embedding document`);
      const chunkCount = await addDocumentToVectorStore(text, metadata);
      console.log(`[DOCUMENT UPLOAD] Successfully created ${chunkCount} chunks`);

      await ctx.reply(
        `Right then, got it. "${filename}" is indexed (${chunkCount} sections). I can now search through it when needed.`
      );
      console.log(`[DOCUMENT UPLOAD] ✓ Complete for user ${userId}: ${filename}`);
    } catch (error) {
      console.error(`[DOCUMENT UPLOAD] ✗ ERROR for user ${userId}:`, error);
      console.error(`[DOCUMENT UPLOAD] Error stack:`, error instanceof Error ? error.stack : "No stack trace");
      await ctx.reply(
        `Sorry, I had trouble processing "${filename}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  bot.on("message", async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;

    console.log(`\n[MESSAGE] User ${userId} (chat ${chatId}): ${text?.substring(0, 100)}${text && text.length > 100 ? "..." : ""}`);

    if (!text) {
      console.log("[MESSAGE] Non-text message ignored");
      return ctx.reply("I only process text right now.");
    }

    const showThinking = thinkingPref.get(ctx.chat.id) ?? false;
    console.log("[MESSAGE] Sending to Watson agent...");
    const result = await runWatsonAgent(ctx.chat.id, text, showThinking);

    console.log(`[MESSAGE] Show thinking preference: ${showThinking}`);
    console.log(`[MESSAGE] Response preview (first 200 chars): ${result.text.substring(0, 200)}`);

    let reply = result.text;
    if (!showThinking) {
      const beforeLength = reply.length;

      // Method 1: Try to filter out explicit thinking tags
      reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      reply = reply.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();

      // Method 2: The LLM outputs thinking paragraphs, then blank line, then actual response
      // Look for common thinking indicators and find the last paragraph break before the response
      const thinkingIndicators = [
        "Okay, the user",
        "Okay, they",
        "I need to",
        "I should",
        "Let me think",
        "The user asked",
        "The user said",
        "Best to respond",
        "Alternatively,",
        "But wait,",
      ];

      // Check if response starts with thinking
      const startsWithThinking = thinkingIndicators.some(indicator =>
        reply.toLowerCase().startsWith(indicator.toLowerCase())
      );

      if (startsWithThinking) {
        // Find the last double newline, which typically separates thinking from response
        const lastDoubleNewline = reply.lastIndexOf('\n\n');
        if (lastDoubleNewline > 0) {
          // Take everything after the last double newline
          reply = reply.substring(lastDoubleNewline).trim();
        }
      }

      if (beforeLength !== reply.length) {
        console.log(`[MESSAGE] Filtered out chain-of-thought (${beforeLength - reply.length} chars removed)`);
      } else {
        console.log(`[MESSAGE] No chain-of-thought patterns found to filter`);
      }
    }

    console.log(`[MESSAGE] Final reply (${reply.length} chars): ${reply.substring(0, 100)}...`);
    await ctx.reply(reply || "Nothing to report.");
  });

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("Error in request:", e.description);
    } else if (e instanceof HttpError) {
      console.error("Could not contact Telegram:", e);
    } else {
      console.error("Unknown error:", e);
    }
  });

  return bot;
}
