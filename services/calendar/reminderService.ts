import { Bot } from "grammy";
import { listEvents } from "./calendarService";
import { loadTokens } from "./calendarStorage";
import type { EventOutput } from "./calendarTypes";

// Track which events we've already sent reminders for
const sentReminders = new Set<string>();

// Configuration
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const REMINDER_LOOKAHEAD_MS = 30 * 60 * 1000; // 30 minutes ahead

/**
 * Check for upcoming events and send reminders
 */
async function checkAndSendReminders(bot: Bot) {
  console.log(`[REMINDER SERVICE] Checking for upcoming events...`);

  try {
    // Get all users with calendar tokens
    const tokenStorage = await loadTokens();
    const userIds = Object.keys(tokenStorage).map(Number);

    console.log(`[REMINDER SERVICE] Checking calendars for ${userIds.length} user(s)`);

    const now = Date.now();
    const lookaheadTime = new Date(now + REMINDER_LOOKAHEAD_MS).toISOString();
    const currentTime = new Date(now).toISOString();

    for (const userId of userIds) {
      try {
        // Get upcoming events within the lookahead window
        const events = await listEvents(userId, {
          timeMin: currentTime,
          timeMax: lookaheadTime,
          maxResults: 20,
        });

        console.log(`[REMINDER SERVICE] User ${userId}: ${events.length} upcoming event(s) in next 30 min`);

        for (const event of events) {
          const reminderKey = `${userId}_${event.id}_${event.startTime}`;

          // Skip if we've already sent a reminder for this event
          if (sentReminders.has(reminderKey)) {
            continue;
          }

          // Calculate time until event
          const eventStart = new Date(event.startTime).getTime();
          const minutesUntil = Math.floor((eventStart - now) / (60 * 1000));

          // Only send reminder if event is within lookahead window
          if (minutesUntil >= 0 && minutesUntil <= 30) {
            await sendReminder(bot, userId, event, minutesUntil);
            sentReminders.add(reminderKey);
            console.log(`[REMINDER SERVICE] Sent reminder for: ${event.title} (in ${minutesUntil} min)`);
          }
        }
      } catch (error: any) {
        // Don't crash on individual user errors
        console.error(`[REMINDER SERVICE] Error checking calendar for user ${userId}:`, error.message);
      }
    }

    // Clean up old reminder keys (events from over 1 hour ago)
    cleanupOldReminders(now);
  } catch (error) {
    console.error(`[REMINDER SERVICE] Error in checkAndSendReminders:`, error);
  }
}

/**
 * Send a reminder notification to the user
 */
async function sendReminder(bot: Bot, userId: number, event: EventOutput, minutesUntil: number) {
  try {
    const startTime = new Date(event.startTime).toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    let message = `🔔 *Reminder*\n\n`;
    message += `"${event.title}"\n`;

    if (minutesUntil <= 5) {
      message += `⚠️ Starting in ${minutesUntil} minute(s)!\n`;
    } else {
      message += `Starting in ${minutesUntil} minutes\n`;
    }

    message += `📅 ${startTime}\n`;

    if (event.description) {
      message += `\n${event.description}`;
    }

    await bot.api.sendMessage(userId, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error(`[REMINDER SERVICE] Error sending reminder to user ${userId}:`, error);
  }
}

/**
 * Clean up reminder keys for events that have already passed
 */
function cleanupOldReminders(now: number) {
  const oneHourAgo = now - 60 * 60 * 1000;

  for (const key of sentReminders) {
    // Key format: userId_eventId_startTime
    const parts = key.split("_");
    if (parts.length >= 3) {
      const startTime = parts.slice(2).join("_"); // Handle ISO strings with underscores
      const eventStart = new Date(startTime).getTime();

      if (eventStart < oneHourAgo) {
        sentReminders.delete(key);
      }
    }
  }
}

/**
 * Start the reminder polling service
 */
export function startReminderService(bot: Bot) {
  console.log(`[REMINDER SERVICE] Starting reminder service (polling every ${POLL_INTERVAL_MS / 60000} minutes)`);

  // Initial check
  checkAndSendReminders(bot);

  // Schedule periodic checks
  setInterval(() => {
    checkAndSendReminders(bot);
  }, POLL_INTERVAL_MS);
}
