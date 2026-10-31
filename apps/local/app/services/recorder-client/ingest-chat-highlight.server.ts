import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { chatHighlights } from "@/db/schema";
import type { ChatHighlightEvent } from "recorder-service/chat-highlight-protocol";
import { dbCall } from "@/services/clip-service-handler.helpers";
import type { Database } from "@/services/drizzle-service.server";
import { requireDraftVersionForVideo } from "@/services/draft-guard.server";
import { withDbTransaction } from "@/services/with-db-transaction.server";

/**
 * A CHAT HIGHLIGHT'S EDGE, saved (`ingest.server.ts`): its row when it went
 * on the Live Stream picture, and its `hiddenAtMs` when it went off, both
 * the recorder service's stamps (`chat-highlight-protocol.ts`). Idempotent,
 * as every event's saving is: a replay inserts nothing twice and never moves
 * a hide already saved. It hangs off the Recording Session's Video, so it
 * goes through that Video's Draft guard (docs/DRAFT_GUARD.md); refused, it is
 * not saved, and the reason is logged.
 */
export const ingestChatHighlight = Effect.fn("ingestChatHighlight")(function* (
  db: Database,
  event: ChatHighlightEvent & { recordingSessionId: string },
  videoId: string
) {
  yield* withDbTransaction(db, (tx) =>
    Effect.gen(function* () {
      yield* requireDraftVersionForVideo(tx, videoId);
      if (event.type === "chat-highlight-shown")
        return yield* dbCall(() =>
          tx
            .insert(chatHighlights)
            .values({
              id: event.highlightId,
              videoId,
              recordingSessionId: event.recordingSessionId,
              broadcastId: event.broadcastId,
              messageId: event.messageId,
              author: event.author,
              text: event.text,
              shownAtMs: event.atMs,
            })
            .onConflictDoNothing()
        );
      return yield* dbCall(() =>
        tx
          .update(chatHighlights)
          .set({ hiddenAtMs: event.atMs })
          .where(
            and(
              eq(chatHighlights.id, event.highlightId),
              isNull(chatHighlights.hiddenAtMs)
            )
          )
      );
    })
  ).pipe(
    Effect.catchTag("VersionNotDraftError", (e) =>
      Effect.logWarning(
        `Chat Highlight ${event.highlightId} not saved: ${e.message}`
      )
    )
  );
});
