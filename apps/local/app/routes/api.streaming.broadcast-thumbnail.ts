import { Effect, Schema } from "effect";
import { setThumbnailOnBroadcast } from "@/services/new-broadcast.server";
import { makeAction } from "@/services/route-action.server";

const broadcastThumbnailSchema = Schema.Struct({
  broadcastId: Schema.String,
  /** The CVM Video the Streaming tab is open for. */
  videoId: Schema.String,
  /** One of the Video's thumbnails. */
  thumbnailId: Schema.String,
});

/**
 * A picked Broadcast's thumbnail, set or changed later, before or during the
 * Live Stream (`thumbnails.set`, 50 units). Answers how it went
 * (`ThumbnailResult`): a failure is answered with its reason.
 */
export const action = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const o = yield* Schema.decodeUnknown(broadcastThumbnailSchema)(payload);
      return yield* setThumbnailOnBroadcast(o);
    }),
});
