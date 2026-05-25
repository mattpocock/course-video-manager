import { Config, ConfigProvider, Console, Data, Effect } from "effect";
import { redirect } from "react-router";
import { runtimeLive } from "@/services/layer.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";

class GoogleOAuthError extends Data.TaggedError("GoogleOAuthError")<{
  message: string;
  code?: string;
}> {}

/**
 * Google OAuth2 callback handler.
 * Exchanges the authorization code for tokens and stores them in the database.
 */
export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "/";
  const error = url.searchParams.get("error");

  // Handle OAuth errors from Google
  if (error) {
    console.error("Google OAuth error:", error);
    return redirect(`${state}?error=oauth_${error}`);
  }

  if (!code) {
    console.error("No authorization code received");
    return redirect(`${state}?error=no_code`);
  }

  return Effect.gen(function* () {
    const clientId = yield* Config.string("GOOGLE_CLIENT_ID");
    const clientSecret = yield* Config.string("GOOGLE_CLIENT_SECRET");
    const linkAuthOps = yield* LinkAuthOperationsService;

    // Build the redirect URI (must match what was used in initiate)
    const origin = url.origin;
    const redirectUri = `${origin}/api/auth/google/callback`;

    // Exchange authorization code for tokens
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
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        });

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
        new GoogleOAuthError({
          message: e instanceof Error ? e.message : "Token exchange failed",
        }),
    });

    // Validate we got a refresh token (should always be present with prompt=consent)
    if (!tokenResponse.refresh_token) {
      return yield* new GoogleOAuthError({
        message: "No refresh token received from Google",
        code: "no_refresh_token",
      });
    }

    // Calculate expiry time
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    // Store tokens in database
    yield* linkAuthOps.upsertYoutubeAuth({
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
    });

    yield* Effect.logInfo("YouTube OAuth tokens stored successfully");

    // Redirect back to the original page
    return redirect(state);
  }).pipe(
    Effect.tapErrorCause((e) => Console.log(e)),
    Effect.catchTag("ConfigError", () => {
      return Effect.succeed(redirect("/?error=oauth_not_configured"));
    }),
    Effect.catchTag("GoogleOAuthError", (e) => {
      console.error("Google OAuth error:", e.message);
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
