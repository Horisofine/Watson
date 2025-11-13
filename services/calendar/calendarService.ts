import { google } from "googleapis";
import { getAuthenticatedClient } from "./calendarAuth";
import {
  EventInput,
  EventOutput,
  ListEventsParams,
  GoogleCalendarEvent,
} from "./calendarTypes";

/**
 * Create a calendar event
 */
export async function createEvent(
  userId: number,
  eventData: EventInput
): Promise<EventOutput> {
  console.log(`[CALENDAR] Creating event for user ${userId}: ${eventData.title}`);

  const auth = await getAuthenticatedClient(userId);
  const calendar = google.calendar({ version: "v3", auth });

  const event: GoogleCalendarEvent = {
    summary: eventData.title,
    description: eventData.description,
    start: {
      dateTime: eventData.startTime,
      timeZone: eventData.timeZone || "UTC",
    },
    end: {
      dateTime: eventData.endTime,
      timeZone: eventData.timeZone || "UTC",
    },
  };

  // Add reminders if specified
  if (eventData.reminderMinutes !== undefined) {
    event.reminders = {
      useDefault: false,
      overrides: [{ method: "popup", minutes: eventData.reminderMinutes }],
    };
  }

  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event,
  });

  console.log(`[CALENDAR] Event created: ${response.data.id}`);

  return {
    id: response.data.id!,
    title: response.data.summary!,
    description: response.data.description,
    startTime: response.data.start?.dateTime || response.data.start?.date!,
    endTime: response.data.end?.dateTime || response.data.end?.date!,
    htmlLink: response.data.htmlLink,
  };
}

/**
 * List calendar events
 */
export async function listEvents(
  userId: number,
  params: ListEventsParams = {}
): Promise<EventOutput[]> {
  console.log(`[CALENDAR] Listing events for user ${userId}`);

  const auth = await getAuthenticatedClient(userId);
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: params.timeMin || new Date().toISOString(),
    timeMax: params.timeMax,
    maxResults: params.maxResults || 10,
    singleEvents: true,
    orderBy: "startTime",
    q: params.query,
  });

  const events = response.data.items || [];
  console.log(`[CALENDAR] Found ${events.length} events`);

  return events.map((event) => ({
    id: event.id!,
    title: event.summary || "(No title)",
    description: event.description,
    startTime: event.start?.dateTime || event.start?.date!,
    endTime: event.end?.dateTime || event.end?.date!,
    htmlLink: event.htmlLink,
  }));
}

/**
 * Delete a calendar event
 */
export async function deleteEvent(userId: number, eventId: string): Promise<void> {
  console.log(`[CALENDAR] Deleting event ${eventId} for user ${userId}`);

  const auth = await getAuthenticatedClient(userId);
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.delete({
    calendarId: "primary",
    eventId: eventId,
  });

  console.log(`[CALENDAR] Event deleted: ${eventId}`);
}

/**
 * Find event by title (for easier deletion)
 */
export async function findEventByTitle(
  userId: number,
  title: string
): Promise<EventOutput | null> {
  const events = await listEvents(userId, { query: title, maxResults: 1 });
  return events.length > 0 ? events[0] : null;
}
