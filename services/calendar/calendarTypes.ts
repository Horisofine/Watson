import { calendar_v3 } from "googleapis";

/**
 * OAuth tokens stored per user
 */
export interface UserTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

/**
 * Storage structure for all user tokens
 */
export interface TokenStorage {
  [userId: string]: UserTokens;
}

/**
 * Input for creating a calendar event
 */
export interface EventInput {
  title: string;
  description?: string;
  startTime: string; // ISO 8601 format
  endTime: string; // ISO 8601 format
  reminderMinutes?: number;
  timeZone?: string;
}

/**
 * Simplified event output for Watson
 */
export interface EventOutput {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  htmlLink?: string;
}

/**
 * Parameters for listing events
 */
export interface ListEventsParams {
  maxResults?: number;
  timeMin?: string; // ISO 8601
  timeMax?: string; // ISO 8601
  query?: string; // Search query
}

/**
 * Google Calendar event type alias
 */
export type GoogleCalendarEvent = calendar_v3.Schema$Event;
