import { Config, ConfigProvider, Data, Effect } from "effect";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";

export class AiHeroAuthError extends Data.TaggedError("AiHeroAuthError")<{
  message: string;
  code?: string;
}> {}

export class AiHeroNotAuthenticatedError extends Data.TaggedError(
  "AiHeroNotAuthenticatedError"
)<{}> {}

/**
 * Request a device code from AI Hero's OAuth Device Authorization flow.
 * Returns the device_code, user_code, and verification_uri for the user.
 */
export const requestDeviceCode = Effect.gen(function* () {
  const baseUrl = yield* Config.string("AI_HERO_BASE_URL");

  const response = yield* Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${baseUrl}/oauth/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Device code request failed (${res.status}): ${errorText}`
        );
      }

      return res.json() as Promise<{
        device_code: string;
        user_code: string;
        verification_uri: string;
        verification_uri_complete: string;
        expires_in: number;
        interval: number;
      }>;
    },
    catch: (e) =>
      new AiHeroAuthError({
        message: e instanceof Error ? e.message : "Device code request failed",
        code: "device_code_failed",
      }),
  });

  return response;
}).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv()));

/**
 * Poll AI Hero's token endpoint until the device is authorized or the code expires.
 * Polls every 5 seconds, up to 10 minutes.
 */
export const pollForToken = (deviceCode: string) =>
  Effect.gen(function* () {
    const baseUrl = yield* Config.string("AI_HERO_BASE_URL");
    const maxAttempts = 120; // 10 minutes at 5-second intervals

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        yield* Effect.sleep("5 seconds");
      }

      const result = yield* Effect.tryPromise({
        try: async () => {
          const body = new URLSearchParams();
          body.set("device_code", deviceCode);
          body.set(
            "grant_type",
            "urn:ietf:params:oauth:grant-type:device_code"
          );
          const res = await fetch(`${baseUrl}/oauth/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          });

          const data = await res.json();

          if (!res.ok) {
            return { status: "pending" as const, error: data.error as string };
          }

          return {
            status: "complete" as const,
            access_token: data.access_token as string,
          };
        },
        catch: (e) =>
          new AiHeroAuthError({
            message: e instanceof Error ? e.message : "Token poll failed",
            code: "poll_failed",
          }),
      });

      if (result.status === "complete") {
        // Fetch user info to get the userId
        const userInfo = yield* Effect.tryPromise({
          try: async () => {
            const res = await fetch(`${baseUrl}/oauth/userinfo`, {
              headers: {
                Authorization: `Bearer ${result.access_token}`,
              },
            });

            if (!res.ok) {
              throw new Error(`Userinfo request failed (${res.status})`);
            }

            return res.json() as Promise<{ id: string }>;
          },
          catch: (e) =>
            new AiHeroAuthError({
              message:
                e instanceof Error ? e.message : "Userinfo request failed",
              code: "userinfo_failed",
            }),
        });

        // Store the token in the database
        const linkAuthOps = yield* LinkAuthOperationsService;
        yield* linkAuthOps.upsertAiHeroAuth({
          accessToken: result.access_token,
          userId: userInfo.id,
        });

        return { accessToken: result.access_token, userId: userInfo.id };
      }

      // If the error is not "authorization_pending", the user denied or code expired
      if (
        result.error !== "authorization_pending" &&
        result.error !== "slow_down"
      ) {
        return yield* new AiHeroAuthError({
          message: `Device authorization failed: ${result.error}`,
          code: result.error,
        });
      }
    }

    return yield* new AiHeroAuthError({
      message: "Device authorization timed out after 10 minutes",
      code: "timeout",
    });
  }).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv()));

/**
 * Get the stored AI Hero access token.
 * Returns the access token string if authenticated, or fails with AiHeroNotAuthenticatedError.
 */
export const getAiHeroAccessToken = Effect.gen(function* () {
  const linkAuthOps = yield* LinkAuthOperationsService;
  const auth = yield* linkAuthOps.getAiHeroAuth();

  if (!auth) {
    return yield* new AiHeroNotAuthenticatedError();
  }

  return auth.accessToken;
});

/**
 * Check if the user is authenticated with AI Hero.
 */
export const isAiHeroAuthenticated = Effect.gen(function* () {
  const linkAuthOps = yield* LinkAuthOperationsService;
  const auth = yield* linkAuthOps.getAiHeroAuth();
  return auth !== null;
});
