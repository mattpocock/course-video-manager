import { Effect, Schema } from "effect";
import { broadcastChat } from "@/services/broadcast-chat-live.server";
import { makeAction } from "@/services/route-action.server";

const broadcastPickSchema = Schema.Struct({
  broadcastId: Schema.String,
  liveChatId: Schema.NullOr(Schema.String),
});

/**
 * Matt picked a Broadcast on the Streaming tab: the app server reads its live
 * chat from now until End Stream or another pick, whoever listens.
 */
export const action = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const pick = yield* Schema.decodeUnknown(broadcastPickSchema)(payload);
      yield* broadcastChat().pick(pick);
      return { ok: true };
    }),
});
