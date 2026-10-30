import { Config, ConfigProvider, Console, Effect } from "effect";
import { redirect } from "react-router";

/**
 * Initiates Google OAuth2 flow for YouTube.
 * Redirects to Google's consent screen asking, in one grant, for
 * `youtube.upload` (posting Videos) and `youtube.force-ssl` (the Streaming
 * tab's Broadcasts, binding and live chat). A grant given before
 * `youtube.force-ssl` was asked for keeps uploading; the Streaming tab asks
 * Matt to reconnect once.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") || "/";

  return Effect.gen(function* () {
    const clientId = yield* Config.string("GOOGLE_CLIENT_ID");

    // Build the OAuth redirect URI (callback endpoint)
    const origin = url.origin;
    const redirectUri = `${origin}/api/auth/google/callback`;

    // Build the Google OAuth authorization URL
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    // Store returnTo in state so we can redirect back after auth
    authUrl.searchParams.set("state", returnTo);

    return redirect(authUrl.toString());
  }).pipe(
    Effect.tapErrorCause((e) => Console.log(e)),
    Effect.catchTag("ConfigError", () => {
      return Effect.die(
        new Response("Google OAuth not configured", { status: 500 })
      );
    }),
    Effect.withConfigProvider(ConfigProvider.fromEnv()),
    Effect.runPromise
  );
};
