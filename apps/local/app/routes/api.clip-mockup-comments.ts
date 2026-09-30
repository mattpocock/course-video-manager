import { Effect, Schema } from "effect";
import { ClipMockupCommentOperationsService } from "@/services/db-clip-mockup-comment-operations.server";
import { makeAction } from "@/services/route-action.server";

/**
 * The write end of the Animatic's comment threads — add, edit and delete a
 * Clip Mockup Comment. Every event is one call to the same service
 * `cvm clip-mockup-comment` uses, so the page and the CLI can never write a
 * comment differently. The page reads comments through its own loader, which
 * a fetcher's write revalidates.
 */

const nonEmptyString = Schema.String.pipe(Schema.minLength(1));
const body = Schema.String.pipe(Schema.trimmed(), Schema.minLength(1));

export const ClipMockupCommentEventSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("create"),
    target: Schema.Union(
      Schema.Struct({
        type: Schema.Literal("clip-mockup"),
        id: nonEmptyString,
      }),
      Schema.Struct({
        type: Schema.Literal("clip-mockup-chapter"),
        id: nonEmptyString,
      })
    ),
    body,
  }),
  Schema.Struct({
    type: Schema.Literal("update"),
    commentId: nonEmptyString,
    body,
  }),
  Schema.Struct({
    type: Schema.Literal("delete"),
    commentId: nonEmptyString,
  })
);

export type ClipMockupCommentEvent =
  typeof ClipMockupCommentEventSchema.Encoded;

/**
 * A write's outcome as DATA, not as a thrown response: a Version that is not
 * a Draft refuses the write, and that must show in the thread the author is
 * typing in, not take the Animatic down to an error boundary mid-watch.
 */
export type ClipMockupCommentWriteResult =
  { ok: true } | { ok: false; message: string };

export const action = makeAction({
  errors: { NotFoundError: 404 },
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknown(ClipMockupCommentEventSchema)(
        payload
      );
      const commentOps = yield* ClipMockupCommentOperationsService;

      switch (event.type) {
        case "create":
          yield* commentOps.createClipMockupComment(event.target, event.body);
          break;
        case "update":
          yield* commentOps.updateClipMockupComment(event.commentId, {
            body: event.body,
          });
          break;
        case "delete":
          yield* commentOps.deleteClipMockupComment(event.commentId);
          break;
      }
      return { ok: true } satisfies ClipMockupCommentWriteResult;
    }).pipe(
      Effect.catchTag("VersionNotDraftError", () =>
        Effect.succeed({
          ok: false,
          message:
            "Not saved: this Video's Course Version is not a Draft. Open the Draft to comment.",
        } satisfies ClipMockupCommentWriteResult)
      )
    ),
});
