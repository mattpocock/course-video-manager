import { Effect } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { makeAction } from "@/services/route-action.server";
import type { Route } from "./+types/api.clips.$clipId.web-links";
import { data } from "react-router";

/**
 * Persist / remove the web links that were on screen during a clip.
 *
 * POST   { links: { url, title, capturedAt }[] }  -> creates clip_web_link rows
 * DELETE { linkId: string }                        -> removes one link
 *
 * Called by the Video Editor when a freshly-recorded clip's captured links are
 * ready (POST) and when the user removes a mis-captured link chip (DELETE).
 */
const createAction = makeAction({
  input: "json",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        !("links" in payload)
      ) {
        return yield* Effect.die(
          data("Body must be a JSON object with a links array", { status: 400 })
        );
      }

      const { links } = payload as { links: unknown };
      if (!Array.isArray(links)) {
        return yield* Effect.die(
          data("links must be an array", { status: 400 })
        );
      }

      const parsed = links.map((link) => {
        const l = link as Record<string, unknown>;
        return {
          url: String(l.url),
          title: typeof l.title === "string" ? l.title : null,
          capturedAt:
            typeof l.capturedAt === "number" ? l.capturedAt : Date.now(),
        };
      });

      const clipOps = yield* ClipOperationsService;
      const webLinks = yield* clipOps.createClipWebLinks(params.clipId!, parsed);
      return data({ webLinks });
    }),
});

const deleteAction = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        typeof (payload as Record<string, unknown>).linkId !== "string"
      ) {
        return yield* Effect.die(
          data("Body must include a linkId string", { status: 400 })
        );
      }

      const { linkId } = payload as { linkId: string };
      const clipOps = yield* ClipOperationsService;
      const result = yield* clipOps.deleteClipWebLink(linkId);
      return data(result);
    }),
});

export const action = async (args: Route.ActionArgs) => {
  if (args.request.method === "POST") {
    return createAction(args);
  }
  if (args.request.method === "DELETE") {
    return deleteAction(args);
  }
  return data("Method not allowed", { status: 405 });
};
