import { Effect, Schema } from "effect";
import { data } from "react-router";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { resolveClipMockupSpeech } from "@/cli/commands/clip-mockup.speech";
import { makeAction, makeLoader } from "@/services/route-action.server";

/**
 * The read and write end of the video editor's Clip Mockup list.
 *
 * A route of its own rather than three more cases in `/api/course-editor`,
 * for one reason: editing a line RE-SYNTHESISES it, and that reaches the
 * Gemini TTS service and the Clip Mockup directory on disk. Every handler in
 * `course-editor-service-handler.ts` calls nothing but a `@cvm/core` ops
 * service; putting the one operation that needs a machine in there would make
 * that true of none of them.
 *
 * Both writes go through EXACTLY the path `cvm clip-mockup` already takes —
 * `resolveClipMockupSpeech` then `setClipMockupLine`, and `moveClipMockup`
 * with the same `before` anchor `--before`/`--after` resolve to — so the CLI
 * and this list can never reorder or re-voice a Clip Mockup differently. That
 * shared path is also why this route adds no test seam of its own: the
 * behaviour is already asserted at the CLI seam.
 */

const nonEmptyString = Schema.String.pipe(Schema.minLength(1));

export const ClipMockupEditorEventSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("update-clip-mockup-line"),
    clipMockupId: nonEmptyString,
    line: nonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("move-clip-mockup"),
    clipMockupId: nonEmptyString,
    /** `null` appends to the end of the Animatic. */
    beforeClipMockupId: Schema.NullOr(nonEmptyString),
  }),
  Schema.Struct({
    type: Schema.Literal("delete-clip-mockup"),
    clipMockupId: nonEmptyString,
  })
);

export type ClipMockupEditorEvent = typeof ClipMockupEditorEventSchema.Type;

/** One row as the list renders it. `order` never reaches the browser: position is the index. */
export type ClipMockupListRow = {
  id: string;
  line: string;
  durationSeconds: number | null;
};

export type ClipMockupListData = { clipMockups: ClipMockupListRow[] };

/**
 * A write's outcome as DATA, not as a thrown response.
 *
 * A failed synthesis must land on the row it belongs to, not on the editor's
 * error boundary: the author is mid-session with a timeline open, and losing
 * the page because Gemini 503'd would cost far more than the edit. `ok: false`
 * carries the message the row shows.
 */
export type ClipMockupWriteResult =
  { ok: true } | { ok: false; message: string };

export const loader = makeLoader({
  effect: ({ request }) =>
    Effect.gen(function* () {
      const videoId = new URL(request.url).searchParams.get("videoId");
      if (!videoId) {
        return yield* Effect.die(data("Missing videoId", { status: 400 }));
      }
      const clipMockupOps = yield* ClipMockupOperationsService;
      const rows = yield* clipMockupOps.listClipMockupsByVideoId(videoId);
      return {
        clipMockups: rows.map((row) => ({
          id: row.id,
          line: row.line,
          durationSeconds: row.durationSeconds,
        })),
      } satisfies ClipMockupListData;
    }),
});

export const action = makeAction({
  errors: { NotFoundError: 404, InvalidClipMockupPathError: 400 },
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknown(ClipMockupEditorEventSchema)(
        payload
      );
      const clipMockupOps = yield* ClipMockupOperationsService;

      switch (event.type) {
        case "move-clip-mockup": {
          // Ordering only — the same service call, with the same anchor, that
          // `cvm clip-mockup move` makes. No frame is read, written or moved.
          yield* clipMockupOps.moveClipMockup(
            event.clipMockupId,
            event.beforeClipMockupId
          );
          return { ok: true } satisfies ClipMockupWriteResult;
        }

        case "delete-clip-mockup": {
          yield* clipMockupOps.deleteClipMockup(event.clipMockupId);
          return { ok: true } satisfies ClipMockupWriteResult;
        }

        case "update-clip-mockup-line": {
          const row = yield* clipMockupOps.getClipMockupById(
            event.clipMockupId
          );
          const videoOps = yield* VideoOperationsService;
          const video = yield* videoOps.getVideoDeepById(row.videoId);

          // New WORDS are new SPEECH. Synthesise FIRST and only then write:
          // a row whose duration no longer measures its line would make the
          // Animatic's run-time estimate quietly wrong, and that is the one
          // state this list must never be able to leave behind.
          return yield* Effect.gen(function* () {
            const speech = yield* resolveClipMockupSpeech({
              lineageId: video.lineageId,
              line: event.line,
            });
            yield* clipMockupOps.setClipMockupLine(
              event.clipMockupId,
              event.line,
              speech
            );
            return { ok: true } satisfies ClipMockupWriteResult;
          }).pipe(
            Effect.catchTag("SpeechSynthesisError", (error) =>
              Effect.succeed({
                ok: false,
                message: `The line was not saved: ${error.message}`,
              } satisfies ClipMockupWriteResult)
            )
          );
        }
      }
    }),
});
