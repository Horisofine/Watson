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
import { generateAuthUrl, exchangeCodeForTokens } from "./services/calendar/calendarAuth";
import { hasValidTokens } from "./services/calendar/calendarStorage";
import { trackError } from "./services/errorTracking";

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
    { command: "calendar_auth", description: "Connect your Google Calendar" },
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

  bot.command("calendar_auth", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return ctx.reply("Could not identify user.");
    }

    // Check if already authenticated
    if (await hasValidTokens(userId)) {
      return ctx.reply("✅ Your Google Calendar is already connected! You can create events, list schedules, and set reminders.");
    }

    // Generate OAuth URL
    const authUrl = generateAuthUrl();

    await ctx.reply(
      `📅 To connect your Google Calendar:\n\n` +
      `1. Open this link in your browser:\n${authUrl}\n\n` +
      `2. Sign in with your Google account\n` +
      `3. Grant permission to access your calendar\n` +
      `4. Copy the authorization code\n` +
      `5. Send me the code with: /auth_code YOUR_CODE`
    );
  });

  bot.command("auth_code", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return ctx.reply("Could not identify user.");
    }

    const code = ctx.message?.text?.split(" ").slice(1).join(" ").trim();

    if (!code) {
      return ctx.reply("Please provide the authorization code. Usage: /auth_code YOUR_CODE");
    }

    try {
      await exchangeCodeForTokens(userId, code);
      await ctx.reply("✅ Google Calendar connected successfully! You can now create events, list your schedule, and set reminders.");
    } catch (error: any) {
      console.error("Error exchanging auth code:", error);
      await ctx.reply(`❌ Failed to connect calendar: ${error.message}\n\nPlease try /calendar_auth again.`);
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

    // Default to false if not set (thinking disabled by default)
    const showThinking = thinkingPref.get(ctx.chat.id) ?? false;
    console.log(`[MESSAGE] Show thinking: ${showThinking}`);
    console.log("[MESSAGE] Sending to Watson agent...");
    const result = await runWatsonAgent(ctx.chat.id, text, showThinking);

    console.log(`[MESSAGE] Response preview (first 200 chars): ${result.text.substring(0, 200)}`);

    const reply = result.text;
    console.log(`[MESSAGE] Final reply (${reply.length} chars): ${reply.substring(0, 100)}...`);
    await ctx.reply(reply || "Nothing to report.");
  });

  bot.catch(async (err) => {
    const ctx = err.ctx;
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;

    let errorType = "UNKNOWN_ERROR";
    let errorMessage = String(e);

    if (e instanceof GrammyError) {
      errorType = "GRAMMY_ERROR";
      errorMessage = e.description;
      console.error("Error in request:", e.description);
    } else if (e instanceof HttpError) {
      errorType = "HTTP_ERROR";
      errorMessage = String(e);
      console.error("Could not contact Telegram:", e);
    } else {
      console.error("Unknown error:", e);
    }

    // Track error in Langfuse
    await trackError({
      userId,
      chatId,
      errorType,
      errorMessage,
      stackTrace: e instanceof Error ? e.stack : undefined,
      metadata: {
        updateId: ctx.update.update_id,
        updateType: Object.keys(ctx.update).filter(k => k !== "update_id")[0],
      },
    });
  });

  return bot;
}
