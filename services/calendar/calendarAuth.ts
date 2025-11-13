import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getTokensForUser, saveTokensForUser } from "./calendarStorage";
import { UserTokens } from "./calendarTypes";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

/**
 * Create OAuth2 client with credentials from environment
 */
export function createOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google Calendar credentials not configured in environment");
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob" // Special redirect URI for installed apps
  );
}

/**
 * Generate OAuth URL for user to authenticate
 */
export function generateAuthUrl(): string {
  const oauth2Client = createOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: "offline", // Request refresh token
    scope: SCOPES,
    prompt: "consent", // Force consent screen to get refresh token
  });
}

/**
 * Exchange authorization code for tokens and save them
 */
export async function exchangeCodeForTokens(
  userId: number,
  code: string
): Promise<UserTokens> {
  const oauth2Client = createOAuth2Client();

  console.log(`[CALENDAR] Exchanging auth code for user ${userId}`);

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Failed to obtain tokens from Google");
  }

  const userTokens: UserTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope || SCOPES.join(" "),
    token_type: tokens.token_type || "Bearer",
    expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
  };

  await saveTokensForUser(userId, userTokens);
  console.log(`[CALENDAR] Tokens saved for user ${userId}`);

  return userTokens;
}

/**
 * Get authenticated OAuth2 client for a user
 * Automatically refreshes expired tokens
 */
export async function getAuthenticatedClient(userId: number): Promise<OAuth2Client> {
  const tokens = await getTokensForUser(userId);

  if (!tokens) {
    throw new Error("User not authenticated. Please run /calendar_auth first.");
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Check if token is expired or about to expire (within 5 minutes)
  const now = Date.now();
  if (tokens.expiry_date && tokens.expiry_date - now < 5 * 60 * 1000) {
    console.log(`[CALENDAR] Refreshing expired token for user ${userId}`);

    try {
      const { credentials } = await oauth2Client.refreshAccessToken();

      const updatedTokens: UserTokens = {
        ...tokens,
        access_token: credentials.access_token!,
        expiry_date: credentials.expiry_date || Date.now() + 3600 * 1000,
      };

      await saveTokensForUser(userId, updatedTokens);
      console.log(`[CALENDAR] Token refreshed for user ${userId}`);
    } catch (error) {
      console.error(`[CALENDAR] Failed to refresh token:`, error);
      throw new Error("Failed to refresh authentication. Please run /calendar_auth again.");
    }
  }

  return oauth2Client;
}
