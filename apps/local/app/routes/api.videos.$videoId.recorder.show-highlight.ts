import { Effect, Schema } from "effect";
import { broadcastChat } from "@/services/broadcast-chat-live.server";
import { showChatHighlight } from "@/services/recorder-client/chat-highlight.server";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const showSchema = Schema.Struct({ messageId: Schema.String });

/**
 * Show a Chat Highlight: the picked Broadcast's chat message on the Live
 * Stream picture, replacing any other. Answers once the card is on the
 * picture, with its id and the recorder's stamp; a refusal is a 409.
 */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { messageId } = yield* Schema.decodeUnknown(showSchema)(payload);
      return yield* showChatHighlight({
        client: recorderClient(),
        chat: broadcastChat().snapshot(),
        videoId: params.videoId!,
        messageId,
      });
    }),
});
