import { Config, ConfigProvider, Data, Effect } from "effect";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";

export class DropboxAuthError extends Data.TaggedError("DropboxAuthError")<{
  message: string;
  code?: string;
}> {}

export class DropboxNotAuthenticatedError extends Data.TaggedError(
  "DropboxNotAuthenticatedError"
)<{}> {}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * The Dropbox app credentials the token refresh exchanges a refresh token
 * with. Exported so a run that will need them can resolve them at its EDGE:
 * the refresh below only runs when the stored access token is already inside
 * the five-minute buffer, so reading them here alone made a missing `.env`
 * line a failure that first appeared minutes into a Publish, after every
 * unexported Video had been encoded. See `.sandcastle/CODING_STANDARDS.md`.
 */
export const dropboxAppCredentials = Config.all({
  appKey: Config.string("DROPBOX_APP_KEY"),
  appSecret: Config.string("DROPBOX_APP_SECRET"),
});

const refreshAccessToken = Effect.fn("refreshDropboxAccessToken")(function* (
  refreshToken: string
) {
  const { appKey, appSecret } = yield* dropboxAppCredentials;

  const tokenResponse = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: appKey,
          client_secret: appSecret,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Dropbox token refresh failed: ${errorData}`);
      }

      return response.json() as Promise<{
        access_token: string;
        expires_in: number;
        token_type: string;
      }>;
    },
    catch: (e) =>
      new DropboxAuthError({
        message:
          e instanceof Error ? e.message : "Dropbox token refresh failed",
        code: "refresh_failed",
      }),
  });

  return {
    accessToken: tokenResponse.access_token,
    expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
  };
});

export const getValidDropboxAccessToken = Effect.gen(function* () {
  const linkAuthOps = yield* LinkAuthOperationsService;
  const auth = yield* linkAuthOps.getDropboxAuth();

  if (!auth) {
    return yield* new DropboxNotAuthenticatedError();
  }

  const now = Date.now();
  const expiresAt = auth.expiresAt.getTime();
  const isExpired = now >= expiresAt - TOKEN_REFRESH_BUFFER_MS;

  if (isExpired) {
    const newTokens = yield* refreshAccessToken(auth.refreshToken).pipe(
      Effect.withConfigProvider(ConfigProvider.fromEnv())
    );

    yield* linkAuthOps.updateDropboxAccessToken({
      accessToken: newTokens.accessToken,
      expiresAt: newTokens.expiresAt,
    });

    yield* Effect.logInfo("Dropbox access token refreshed successfully");
    return newTokens.accessToken;
  }

  return auth.accessToken;
});

export const isDropboxAuthenticated = Effect.gen(function* () {
  const linkAuthOps = yield* LinkAuthOperationsService;
  const auth = yield* linkAuthOps.getDropboxAuth();
  return auth !== null;
});
