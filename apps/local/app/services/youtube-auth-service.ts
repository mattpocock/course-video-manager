import { Config, Data, Effect } from "effect";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { getValidOAuthAccessToken } from "@/services/oauth-token-refresh";

export class YouTubeAuthError extends Data.TaggedError("YouTubeAuthError")<{
  message: string;
  code?: string;
}> {}

export class NotAuthenticatedError extends Data.TaggedError(
  "NotAuthenticatedError"
)<{}> {}

/**
 * Get a valid access token, refreshing if necessary.
 * Returns the access token string if authenticated, or fails with NotAuthenticatedError.
 */
export const getValidAccessToken = Effect.gen(function* () {
  const linkAuthOps = yield* LinkAuthOperationsService;
  return yield* getValidOAuthAccessToken({
    name: "YouTube",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    clientCredentials: Config.all({
      clientId: Config.string("GOOGLE_CLIENT_ID"),
      clientSecret: Config.string("GOOGLE_CLIENT_SECRET"),
    }),
    getStoredTokens: linkAuthOps.getYoutubeAuth(),
    saveAccessToken: linkAuthOps.updateYoutubeAccessToken,
    notAuthenticated: () => new NotAuthenticatedError(),
    refreshFailed: (message) =>
      new YouTubeAuthError({ message, code: "refresh_failed" }),
  });
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
