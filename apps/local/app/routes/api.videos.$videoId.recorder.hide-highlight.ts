import { Effect, Schema } from "effect";
import { hideChatHighlight } from "@/services/recorder-client/chat-highlight.server";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const hideSchema = Schema.Struct({ highlightId: Schema.String });

/**
 * Hide the Chat Highlight showing. Answers once its card has started to
 * leave the picture, with the recorder's stamp; a refusal is a 409.
 */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { highlightId } = yield* Schema.decodeUnknown(hideSchema)(payload);
      return yield* hideChatHighlight(
        recorderClient(),
        params.videoId!,
        highlightId
      );
    }),
});
