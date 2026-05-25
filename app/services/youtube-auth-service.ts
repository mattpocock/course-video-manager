import { Config, ConfigProvider, Data, Effect } from "effect";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";

export class YouTubeAuthError extends Data.TaggedError("YouTubeAuthError")<{
  message: string;
  code?: string;
}> {}

export class NotAuthenticatedError extends Data.TaggedError(
  "NotAuthenticatedError"
)<{}> {}

/**
 * Buffer time in milliseconds before token expiry to trigger refresh.
 * Refresh tokens 5 minutes before they expire to avoid race conditions.
 */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Refresh the access token using the stored refresh token.
 */
const refreshAccessToken = Effect.fn("refreshAccessToken")(function* (
  refreshToken: string
) {
  const clientId = yield* Config.string("GOOGLE_CLIENT_ID");
  const clientSecret = yield* Config.string("GOOGLE_CLIENT_SECRET");

  const tokenResponse = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Token refresh failed: ${errorData}`);
      }

      return response.json() as Promise<{
        access_token: string;
        expires_in: number;
        token_type: string;
      }>;
    },
    catch: (e) =>
      new YouTubeAuthError({
        message: e instanceof Error ? e.message : "Token refresh failed",
        code: "refresh_failed",
      }),
  });

  return {
    accessToken: tokenResponse.access_token,
    expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
  };
});

/**
 * Get a valid access token, refreshing if necessary.
 * Returns the access token string if authenticated, or fails with NotAuthenticatedError.
 */
export const getValidAccessToken = Effect.gen(function* () {
  const linkAuthOps = yield* LinkAuthOperationsService;
  const auth = yield* linkAuthOps.getYoutubeAuth();

  if (!auth) {
    return yield* new NotAuthenticatedError();
  }

  // Check if token is expired or about to expire
  const now = Date.now();
  const expiresAt = auth.expiresAt.getTime();
  const isExpired = now >= expiresAt - TOKEN_REFRESH_BUFFER_MS;

  if (isExpired) {
    // Refresh the token
    const newTokens = yield* refreshAccessToken(auth.refreshToken).pipe(
      Effect.withConfigProvider(ConfigProvider.fromEnv())
    );

    // Update the database with the new access token
    yield* linkAuthOps.updateYoutubeAccessToken({
      accessToken: newTokens.accessToken,
      expiresAt: newTokens.expiresAt,
    });

    yield* Effect.logInfo("YouTube access token refreshed successfully");
    return newTokens.accessToken;
  }

  return auth.accessToken;
});

/**
 * Check if the user is authenticated with YouTube.
 * Returns true if there are stored tokens (doesn't validate them).
 */
export const isYoutubeAuthenticated = Effect.gen(function* () {
  const linkAuthOps = yield* LinkAuthOperationsService;
  const auth = yield* linkAuthOps.getYoutubeAuth();
  return auth !== null;
});
