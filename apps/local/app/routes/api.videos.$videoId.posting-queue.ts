import { Effect, Schema } from "effect";
import { makeAction, makeLoader } from "@/services/route-action.server";
import {
  addShortToPostingQueue,
  previewShortPost,
  saveShortDescription,
} from "@/features/video-posting/shorts-posting-queue.server";

/**
 * The Shorts page modal and the Posting Queue (#2617). GET: the Short's
 * description and when it would go out (the `cvm short post --dry-run`
 * verdict). POST: save the description on the Video, or add the Short to
 * the Posting Queue the way `cvm short post` does.
 */
export const loader = makeLoader({
  effect: ({ params }) => previewShortPost(params.videoId!),
});

const postingQueueRequest = Schema.Union(
  Schema.Struct({
    intent: Schema.Literal("save-description"),
    description: Schema.String,
  }),
  Schema.Struct({
    intent: Schema.Literal("add"),
    title: Schema.String,
    description: Schema.String,
  })
);

export const action = makeAction({
  input: "json",
  errors: { VideoTitleTakenError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const request = yield* Schema.decodeUnknown(postingQueueRequest)(payload);
      if (request.intent === "save-description") {
        yield* saveShortDescription({
          videoId,
          description: request.description,
        });
        return { saved: true };
      }
      const verdict = yield* addShortToPostingQueue({
        videoId,
        title: request.title,
        description: request.description,
      });
      return { verdict };
    }),
});
