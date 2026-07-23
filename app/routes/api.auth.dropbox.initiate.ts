import { Config, ConfigProvider, Console, Effect } from "effect";
import { redirect } from "react-router";
import { runtimeLive } from "@/services/layer.server";

export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") || "/";

  return Effect.gen(function* () {
    const appKey = yield* Config.string("DROPBOX_APP_KEY");

    const origin = url.origin;
    const redirectUri = `${origin}/api/auth/dropbox/callback`;

    const authUrl = new URL("https://www.dropbox.com/oauth2/authorize");
    authUrl.searchParams.set("client_id", appKey);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("token_access_type", "offline");
    authUrl.searchParams.set("state", returnTo);

    return redirect(authUrl.toString());
  }).pipe(
    Effect.tapErrorCause((e) => Console.log(e)),
    Effect.catchTag("ConfigError", () => {
      return Effect.die(
        new Response("Dropbox OAuth not configured", { status: 500 })
      );
    }),
    Effect.withConfigProvider(ConfigProvider.fromEnv()),
    Effect.catchAll(() => {
      return Effect.die(new Response("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
