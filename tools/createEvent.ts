import { tool } from "langchain";
import * as z from "zod";
import { createEvent } from "../services/calendar/calendarService";

export const createEventTool = tool(
  async (input, config) => {
    console.log(`\n[TOOL: create_calendar_event] Creating event: ${input.title}`);

    const userId = config?.metadata?.userId as number | undefined;

    if (!userId) {
      return "Error: User ID not available.";
    }

    try {
      const event = await createEvent(userId, {
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
        reminderMinutes: input.reminderMinutes,
      });

      const startDate = new Date(event.startTime).toLocaleString();
      return `Event created successfully: "${event.title}" on ${startDate}. Event ID: ${event.id}`;
    } catch (error: any) {
      console.error(`[TOOL: create_calendar_event] Error:`, error);

      if (error.message.includes("not authenticated")) {
        return "You haven't connected your Google Calendar yet. Please use /calendar_auth to authenticate first.";
      }

      return `Error creating calendar event: ${error.message}`;
    }
  },
  {
    name: "create_calendar_event",
    description:
      "Create a new event in the user's Google Calendar. Use this when the user wants to schedule something, set up a meeting, or add an appointment. The LLM should convert natural language dates/times to ISO 8601 format.",
    schema: z.object({
      title: z.string().describe("Event title/summary"),
      description: z.string().optional().describe("Event description or notes"),
      startTime: z
        .string()
        .describe("Start date and time in ISO 8601 format (e.g., 2024-01-15T14:00:00Z)"),
      endTime: z
        .string()
        .describe("End date and time in ISO 8601 format (e.g., 2024-01-15T15:00:00Z)"),
      reminderMinutes: z
        .number()
        .optional()
        .describe("Minutes before event to send reminder (e.g., 30 for 30 minutes before)"),
    }),
  }
);
