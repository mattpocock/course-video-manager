import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction, makeLoader } from "@/services/route-action.server";

/** One field's Writer Chats, by mode: `?field=<WriterFieldId>`. */
export const loader = makeLoader({
  effect: ({ params, request }) =>
    Effect.gen(function* () {
      const fieldId = new URL(request.url).searchParams.get("field") ?? "";
      const videoOps = yield* VideoOperationsService;
      const chats = yield* videoOps.getWriterChats({
        videoId: params.videoId!,
        fieldId,
      });
      return { chats };
    }),
});

const messagesSchema = Schema.Array(Schema.Unknown);

const writerChatsInput = Schema.Union(
  Schema.Struct({
    intent: Schema.Literal("save"),
    field: Schema.String,
    mode: Schema.String,
    messages: messagesSchema,
  }),
  Schema.Struct({
    intent: Schema.Literal("restore"),
    field: Schema.String,
    chats: Schema.Record({ key: Schema.String, value: messagesSchema }),
  })
);

/** A writer saves a mode's Writer Chat here, and a Cancel restores them all. */
export const action = makeAction({
  input: "json",
  errors: { VersionNotDraftError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknown(writerChatsInput)(payload);
      const videoOps = yield* VideoOperationsService;
      const videoId = params.videoId!;
      if (input.intent === "save") {
        yield* videoOps.saveWriterChat({
          videoId,
          fieldId: input.field,
          mode: input.mode,
          messages: [...input.messages],
        });
      } else {
        yield* videoOps.replaceWriterChats({
          videoId,
          fieldId: input.field,
          chats: Object.fromEntries(
            Object.entries(input.chats).map(([mode, messages]) => [
              mode,
              [...messages],
            ])
          ),
        });
      }
      return { ok: true };
    }),
});
