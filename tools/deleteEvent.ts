import { tool } from "langchain";
import * as z from "zod";
import { deleteEvent, findEventByTitle } from "../services/calendar/calendarService";

export const deleteEventTool = tool(
  async (input, config) => {
    console.log(`\n[TOOL: delete_calendar_event] Deleting event`);

    const userId = config?.metadata?.userId as number | undefined;

    if (!userId) {
      return "Error: User ID not available.";
    }

    try {
      let eventId = input.eventId;

      // If title provided instead of ID, find the event first
      if (!eventId && input.eventTitle) {
        const event = await findEventByTitle(userId, input.eventTitle);

        if (!event) {
          return `No event found with title "${input.eventTitle}". Please check the title and try again.`;
        }

        eventId = event.id;
        console.log(`[TOOL: delete_calendar_event] Found event ${eventId} by title`);
      }

      if (!eventId) {
        return "Error: Either eventId or eventTitle must be provided.";
      }

      await deleteEvent(userId, eventId);

      return `Event deleted successfully.`;
    } catch (error: any) {
      console.error(`[TOOL: delete_calendar_event] Error:`, error);

      if (error.message.includes("not authenticated")) {
        return "You haven't connected your Google Calendar yet. Please use /calendar_auth to authenticate first.";
      }

      if (error.message.includes("not found") || error.response?.status === 404) {
        return "Event not found. It may have already been deleted.";
      }

      return `Error deleting calendar event: ${error.message}`;
    }
  },
  {
    name: "delete_calendar_event",
    description:
      "Delete an event from the user's Google Calendar. Can delete by event ID or by searching for the event title. Use this when the user wants to cancel or remove an event.",
    schema: z.object({
      eventId: z
        .string()
        .optional()
        .describe("The Google Calendar event ID to delete"),
      eventTitle: z
        .string()
        .optional()
        .describe("Search for event by title and delete it (if eventId not provided)"),
    }),
  }
);
