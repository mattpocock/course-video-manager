import { Config, Data, Effect } from "effect";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { getValidOAuthAccessToken } from "@/services/oauth-token-refresh";

export class DropboxAuthError extends Data.TaggedError("DropboxAuthError")<{
  message: string;
  code?: string;
}> {}

export class DropboxNotAuthenticatedError extends Data.TaggedError(
  "DropboxNotAuthenticatedError"
)<{}> {}

/**
 * The Dropbox app credentials the token refresh exchanges a refresh token
 * with. Exported so a run that will need them can resolve them at its EDGE:
 * the refresh below only runs when the stored access token is already inside
 * the five-minute buffer, so reading them here alone made a missing `.env`
 * line a failure that first appeared minutes into a Publish, after every
 * unexported Video had been encoded. See `CODING_STANDARDS.md`.
 */
export const dropboxAppCredentials = Config.all({
  clientId: Config.string("DROPBOX_APP_KEY"),
  clientSecret: Config.string("DROPBOX_APP_SECRET"),
});

export const getValidDropboxAccessToken = Effect.gen(function* () {
  const linkAuthOps = yield* LinkAuthOperationsService;
  return yield* getValidOAuthAccessToken({
    name: "Dropbox",
    tokenEndpoint: "https://api.dropboxapi.com/oauth2/token",
    clientCredentials: dropboxAppCredentials,
    getStoredTokens: linkAuthOps.getDropboxAuth(),
    saveAccessToken: linkAuthOps.updateDropboxAccessToken,
    notAuthenticated: () => new DropboxNotAuthenticatedError(),
    refreshFailed: (message) =>
      new DropboxAuthError({ message, code: "refresh_failed" }),
  });
});
