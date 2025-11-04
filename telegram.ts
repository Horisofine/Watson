import { Bot, GrammyError, HttpError } from "grammy";
import { runWatsonAgent } from "./agent";

type ThinkingPreference = Map<number, boolean>;

export function createTelegramBot(token: string) {
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN missing");
  }

  const bot = new Bot(token);
  const thinkingPref: ThinkingPreference = new Map();

  bot.api.setMyCommands([
    { command: "showthinking", description: "Show the LLM's chain-of-thought" },
    { command: "hidethinking", description: "Hide the LLM's chain-of-thought" },
    {
      command: "contextsize",
      description: "Show current buffered context tokens estimate",
    },
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

  bot.on("message", async (ctx) => {
    const text = ctx.message.text;
    if (!text) {
      return ctx.reply("I only process text right now.");
    }

    const result = await runWatsonAgent(ctx.chat.id, text);
    const showThinking = thinkingPref.get(ctx.chat.id) ?? false;

    let reply = result.text;
    if (!showThinking) {
      reply = reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    }

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
