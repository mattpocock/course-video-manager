import { Config, ConfigProvider, Console, Data, Effect } from "effect";
import { redirect } from "react-router";
import { runtimeLive } from "@/services/layer.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";

class DropboxOAuthError extends Data.TaggedError("DropboxOAuthError")<{
  message: string;
  code?: string;
}> {}

export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "/";
  const error = url.searchParams.get("error");

  if (error) {
    console.error("Dropbox OAuth error:", error);
    return redirect(`${state}?error=oauth_${error}`);
  }

  if (!code) {
    console.error("No authorization code received");
    return redirect(`${state}?error=no_code`);
  }

  return Effect.gen(function* () {
    const appKey = yield* Config.string("DROPBOX_APP_KEY");
    const appSecret = yield* Config.string("DROPBOX_APP_SECRET");
    const linkAuthOps = yield* LinkAuthOperationsService;

    const origin = url.origin;
    const redirectUri = `${origin}/api/auth/dropbox/callback`;

    const tokenResponse = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(
          "https://api.dropboxapi.com/oauth2/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              code,
              grant_type: "authorization_code",
              client_id: appKey,
              client_secret: appSecret,
              redirect_uri: redirectUri,
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.text();
          throw new Error(`Token exchange failed: ${errorData}`);
        }

        return response.json() as Promise<{
          access_token: string;
          refresh_token?: string;
          expires_in: number;
          token_type: string;
        }>;
      },
      catch: (e) =>
        new DropboxOAuthError({
          message: e instanceof Error ? e.message : "Token exchange failed",
        }),
    });

    if (!tokenResponse.refresh_token) {
      return yield* new DropboxOAuthError({
        message: "No refresh token received from Dropbox",
        code: "no_refresh_token",
      });
    }

    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    yield* linkAuthOps.upsertDropboxAuth({
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
    });

    yield* Effect.logInfo("Dropbox OAuth tokens stored successfully");

    return redirect(state);
  }).pipe(
    Effect.tapErrorCause((e) => Console.log(e)),
    Effect.catchTag("ConfigError", () => {
      return Effect.succeed(redirect("/?error=oauth_not_configured"));
    }),
    Effect.catchTag("DropboxOAuthError", (e) => {
      console.error("Dropbox OAuth error:", e.message);
      return Effect.succeed(redirect(`${state}?error=oauth_failed`));
    }),
    Effect.withConfigProvider(ConfigProvider.fromEnv()),
    Effect.catchAll((e) => {
      console.error("OAuth callback error:", e);
      return Effect.succeed(redirect(`${state}?error=oauth_error`));
    }),
    runtimeLive.runPromise
  );
};
