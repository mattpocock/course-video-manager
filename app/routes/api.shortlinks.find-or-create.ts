import { Effect } from "effect";
import { findOrCreateShortLink } from "@/services/ai-hero-shortlink-service";
import { makeAction } from "@/services/route-action.server";

export const action = async (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => {
  const body = await args.request.json();
  const rawBody = body as { url: string; description: string };
  const url =
    typeof rawBody.url === "string" ? rawBody.url.trim() : rawBody.url;
  const description =
    typeof rawBody.description === "string"
      ? rawBody.description.trim()
      : rawBody.description;

  if (!url || !description) {
    return Response.json(
      { error: "url and description are required" },
      { status: 400 }
    );
  }

  return makeAction({
    dump: false,
    effect: () =>
      Effect.gen(function* () {
        const result = yield* findOrCreateShortLink({ url, description });
        return Response.json(result);
      }).pipe(
        Effect.catchTag("AiHeroShortLinkError", (e) =>
          Effect.succeed(Response.json({ error: e.message }, { status: 500 }))
        ),
        Effect.catchTag("AiHeroNotAuthenticatedError", () =>
          Effect.succeed(
            Response.json(
              { error: "Not authenticated with AI Hero" },
              { status: 401 }
            )
          )
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
  })(args);
};
