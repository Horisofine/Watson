import { tool } from "langchain";
import * as z from "zod";
import { listEvents } from "../services/calendar/calendarService";

export const listEventsTool = tool(
  async (input, config) => {
    console.log(`\n[TOOL: list_calendar_events] Listing events`);

    const userId = config?.metadata?.userId as number | undefined;

    if (!userId) {
      return "Error: User ID not available.";
    }

    try {
      const events = await listEvents(userId, {
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        maxResults: input.maxResults || 10,
      });

      if (events.length === 0) {
        return "No upcoming events found in your calendar.";
      }

      const eventList = events
        .map((event, idx) => {
          const start = new Date(event.startTime).toLocaleString();
          const end = new Date(event.endTime).toLocaleString();
          return `${idx + 1}. "${event.title}" - ${start} to ${end}${event.description ? `\n   Description: ${event.description}` : ""}`;
        })
        .join("\n\n");

      return `You have ${events.length} upcoming event(s):\n\n${eventList}`;
    } catch (error: any) {
      console.error(`[TOOL: list_calendar_events] Error:`, error);

      if (error.message.includes("not authenticated")) {
        return "You haven't connected your Google Calendar yet. Please use /calendar_auth to authenticate first.";
      }

      return `Error listing calendar events: ${error.message}`;
    }
  },
  {
    name: "list_calendar_events",
    description:
      "List upcoming events from the user's Google Calendar. Use this when the user asks about their schedule, what events they have, or what's coming up.",
    schema: z.object({
      timeMin: z
        .string()
        .optional()
        .describe("Start time for listing events in ISO 8601 format (defaults to now)"),
      timeMax: z
        .string()
        .optional()
        .describe("End time for listing events in ISO 8601 format"),
      maxResults: z
        .number()
        .optional()
        .describe("Maximum number of events to return (default: 10)"),
    }),
  }
);
