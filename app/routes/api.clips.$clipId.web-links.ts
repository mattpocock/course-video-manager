import { Effect } from "effect";
import { z } from "zod";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { makeAction } from "@/services/route-action.server";
import type { Route } from "./+types/api.clips.$clipId.web-links";
import { data } from "react-router";

/**
 * Persist / remove the web links that were on screen during a clip.
 *
 * POST   { links: { url, title?, capturedAt? }[] }  -> creates clip_web_link rows
 * DELETE { linkId: string }                          -> removes one link
 *
 * Called by the Video Editor when a freshly-recorded clip's captured links are
 * ready (POST) and when the user removes a mis-captured link chip (DELETE).
 */
const createBodySchema = z.object({
  links: z.array(
    z.object({
      url: z.string().min(1),
      title: z.string().nullish(),
      capturedAt: z.number().optional(),
    })
  ),
});

const deleteBodySchema = z.object({
  linkId: z.string().min(1),
});

const createAction = makeAction({
  input: "json",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const parsed = createBodySchema.safeParse(payload);
      if (!parsed.success) {
        return yield* Effect.die(
          data("Body must be a JSON object with a links array", { status: 400 })
        );
      }

      const links = parsed.data.links.map((link) => ({
        url: link.url,
        title: link.title ?? null,
        capturedAt: link.capturedAt ?? Date.now(),
      }));

      const clipOps = yield* ClipOperationsService;
      const webLinks = yield* clipOps.createClipWebLinks(params.clipId!, links);
      return data({ webLinks });
    }),
});

const deleteAction = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const parsed = deleteBodySchema.safeParse(payload);
      if (!parsed.success) {
        return yield* Effect.die(
          data("Body must include a linkId string", { status: 400 })
        );
      }

      const clipOps = yield* ClipOperationsService;
      const result = yield* clipOps.deleteClipWebLink(parsed.data.linkId);
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
