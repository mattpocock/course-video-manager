import { Effect } from "effect";
import { pollForToken } from "@/services/ai-hero-auth-service";
import { makeAction } from "@/services/route-action.server";

export const action = async (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => {
  const body = await args.request.json();
  const deviceCode = body.deviceCode as string;

  if (!deviceCode) {
    return Response.json({ error: "deviceCode is required" }, { status: 400 });
  }

  return makeAction({
    dump: false,
    effect: () =>
      Effect.gen(function* () {
        const result = yield* pollForToken(deviceCode);
        return Response.json({
          success: true,
          userId: result.userId,
        });
      }).pipe(
        Effect.catchTag("AiHeroAuthError", (e) =>
          Effect.succeed(
            Response.json({ error: e.message, code: e.code }, { status: 400 })
          )
        )
      ),
  })(args);
};
