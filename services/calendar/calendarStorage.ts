import { TokenStorage, UserTokens } from "./calendarTypes";

const TOKENS_PATH = process.env.CALENDAR_TOKENS_PATH || "./data/calendar_tokens.json";

/**
 * Load all user tokens from disk
 */
export async function loadTokens(): Promise<TokenStorage> {
  try {
    const file = Bun.file(TOKENS_PATH);
    if (await file.exists()) {
      return await file.json();
    }
  } catch (error) {
    console.error(`[CALENDAR] Error loading tokens:`, error);
  }
  return {};
}

/**
 * Save all user tokens to disk
 */
export async function saveTokens(tokens: TokenStorage): Promise<void> {
  try {
    await Bun.write(TOKENS_PATH, JSON.stringify(tokens, null, 2));
    console.log(`[CALENDAR] Tokens saved to ${TOKENS_PATH}`);
  } catch (error) {
    console.error(`[CALENDAR] Error saving tokens:`, error);
    throw error;
  }
}

/**
 * Get tokens for a specific user
 */
export async function getTokensForUser(userId: number): Promise<UserTokens | null> {
  const tokens = await loadTokens();
  return tokens[userId.toString()] || null;
}

/**
 * Save tokens for a specific user
 */
export async function saveTokensForUser(userId: number, userTokens: UserTokens): Promise<void> {
  const tokens = await loadTokens();
  tokens[userId.toString()] = userTokens;
  await saveTokens(tokens);
}

/**
 * Check if user has valid tokens
 */
export async function hasValidTokens(userId: number): Promise<boolean> {
  const tokens = await getTokensForUser(userId);
  if (!tokens) return false;

  // Check if tokens exist and have refresh_token
  return !!(tokens.access_token && tokens.refresh_token);
}

/**
 * Delete tokens for a user
 */
export async function deleteTokensForUser(userId: number): Promise<void> {
  const tokens = await loadTokens();
  delete tokens[userId.toString()];
  await saveTokens(tokens);
  console.log(`[CALENDAR] Deleted tokens for user ${userId}`);
}
