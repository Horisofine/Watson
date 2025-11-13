import { createTelegramBot } from "./telegram";
import { startReminderService } from "./services/calendar/reminderService";
import { loadMemoryFromDisk } from "./rag";

// Load conversation memory from disk on startup
loadMemoryFromDisk();

const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const bot = createTelegramBot(token);

bot.start();

// Start the calendar reminder service
startReminderService(bot);

console.log("Watson bot is running.");
