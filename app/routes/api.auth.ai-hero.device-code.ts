import { Effect } from "effect";
import { requestDeviceCode } from "@/services/ai-hero-auth-service";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  dump: false,
  effect: () =>
    Effect.gen(function* () {
      const result = yield* requestDeviceCode;
      return Response.json({
        deviceCode: result.device_code,
        userCode: result.user_code,
        verificationUri: result.verification_uri_complete,
        expiresIn: result.expires_in,
        interval: result.interval,
      });
    }).pipe(
      Effect.catchTag("AiHeroAuthError", (e) =>
        Effect.succeed(Response.json({ error: e.message }, { status: 500 }))
      ),
      Effect.catchTag("ConfigError", () =>
        Effect.succeed(
          Response.json(
            { error: "AI_HERO_BASE_URL is not configured" },
            { status: 500 }
          )
        )
      )
    ),
});
