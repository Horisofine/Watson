import { createTelegramBot } from "./telegram";

const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const bot = createTelegramBot(token);

bot.start();

console.log("Watson bot is running.");
