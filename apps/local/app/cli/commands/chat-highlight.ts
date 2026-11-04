import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { detail, emitNdjson, notFound, parseError } from "@/cli/helpers";
import { draftIdOption, optionalDraftId } from "../entity-id";
import { HELP, LIST_HELP } from "./chat-highlight.help";

/**
 * `cvm chat-highlight list`: READ-ONLY. A Streamed Recording Session's Chat
 * Highlights, timed on its clock, so an agent can cut a Short around one and
 * card it (`overlay add --kind chatCard --chat-highlight <id>`).
 */

const sessionOpt = Options.text("recording-session").pipe(
  Options.withDescription("List this Recording Session's Chat Highlights."),
  Options.optional
);

const videoOpt = draftIdOption("video", "video").pipe(
  Options.withDescription(
    "List those of every Recording Session this Video's Clips come from."
  ),
  Options.optional
);

/** One Recording Session's Chat Highlights, as `list` prints them. */
const sessionHighlights = (recordingSessionId: string) =>
  Effect.gen(function* () {
    const overlayOps = yield* OverlayOperationsService;
    const session =
      yield* overlayOps.getRecordingSessionChatHighlights(recordingSessionId);
    if (!session) return undefined;
    const secs = (ms: number) => (ms - session.t0Ms) / 1000;
    return session.highlights.map((h) => ({
      id: h.id,
      recordingSessionId: h.recordingSessionId,
      shownAt: secs(h.shownAtMs),
      hiddenAt: h.hiddenAtMs === null ? null : secs(h.hiddenAtMs),
      author: h.author,
      text: h.text,
    }));
  });

/** The Recording Sessions a Video's active Clips come from, in Clip order. */
const videoSessionIds = (videoId: string) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps
      .getVideoWithClipsById(videoId)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("video", videoId)));
    const ids = video.clips.flatMap((c) =>
      c.recordingSessionId === null ? [] : [c.recordingSessionId]
    );
    return [...new Set(ids)];
  });

const listCmd = Command.make(
  "list",
  { recordingSession: sessionOpt, video: videoOpt },
  ({ recordingSession, video: videoRef }) =>
    Effect.gen(function* () {
      const sessionId = Option.getOrUndefined(recordingSession);
      const videoId = yield* optionalDraftId(videoRef);
      if ((sessionId === undefined) === (videoId === undefined)) {
        return yield* parseError(
          "list needs exactly one of --recording-session / --video",
          "chatHighlight"
        );
      }
      if (sessionId !== undefined) {
        const rows = yield* sessionHighlights(sessionId);
        if (!rows) return yield* notFound("recordingSession", sessionId);
        return yield* emitNdjson(rows);
      }
      for (const id of yield* videoSessionIds(videoId!)) {
        yield* emitNdjson((yield* sessionHighlights(id)) ?? []);
      }
    })
).pipe(Command.withDescription(detail(LIST_HELP)));

export const chatHighlightCommand = Command.make("chat-highlight").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([listCmd])
);
