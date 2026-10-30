import { Data, Effect, Either, Option, Redacted } from "effect";
import { eq } from "drizzle-orm";
import { micEqSettings } from "@/db/schema";
import {
  DEFAULT_MIC_EQ,
  DEFAULT_MIC_OFFSET_MS,
  MIC_EQ_SETTING_ID,
  type MicEq,
} from "@cvm/core/features/videos/recorder";
import type { SilenceLength } from "@/silence-detection-constants";
import {
  type Broadcast,
  broadcastRefusal,
} from "@/features/streaming/broadcast";
import { dbCall } from "@/services/clip-service-handler.helpers";
import type { Database } from "@/services/drizzle-service.server";
import {
  pairMicOffsetMs,
  requireFreshAVCalibration,
} from "@/services/av-calibration.server";
import {
  bindBroadcast,
  findKeysStream,
  listBroadcasts,
} from "@/services/youtube-live-service";
import {
  readStreamKey,
  STREAM_KEY_MISSING,
  STREAM_KEY_SETTING,
} from "@/services/stream-key.server";
import type { RecorderClient } from "./client.server";
import { requireRecordableVideo } from "./record-guard.server";
import { recorderCommand } from "./recorder-command";

/**
 * GO LIVE on the app server (ADR 0054): everything Record checks, and what
 * only a Live Stream needs, gathered so the refusal names every reason that
 * applies at once. The recorder's own reasons come from its state here; the
 * recorder service adds what only it knows when the command reaches it.
 * Then one command (`start-stream`) arms, streams and records.
 */

/** Go Live refused: every reason that applied. */
export class GoLiveRefusedError extends Data.TaggedError("GoLiveRefusedError")<{
  readonly reasons: readonly string[];
  readonly message: string;
}> {}

export const NO_BROADCAST = "Pick a Broadcast first.";
export const BROADCAST_GONE =
  "The picked Broadcast is no longer upcoming or active on YouTube: refresh the list and pick again.";
export const RECONNECT_GOOGLE =
  "Reconnect Google, so CVM can check the Broadcast with YouTube.";

/** No YouTube stream's ingest name is the Stream Key: names the setting, never the key. */
export const NO_MATCHING_STREAM = `No YouTube stream on the channel uses the Stream Key: check ${STREAM_KEY_SETTING} in the .env file at the repo root matches a stream key in YouTube Studio.`;

/** The picked Broadcast, and why it can't be streamed to, if it can't. */
const checkBroadcast = (broadcastId: string | null) =>
  Effect.gen(function* () {
    const refused = (reason: string) => ({
      broadcast: null,
      reasons: [reason],
    });
    if (broadcastId === null) return refused(NO_BROADCAST);
    const answer = yield* listBroadcasts.pipe(
      Effect.catchTag("YouTubeLiveError", (e) =>
        Effect.succeed({ status: "failed" as const, message: e.message })
      )
    );
    switch (answer.status) {
      case "failed":
        return refused(
          `Could not check the Broadcast with YouTube: ${answer.message}`
        );
      case "needs-reconnect":
        return refused(RECONNECT_GOOGLE);
      case "listed": {
        const broadcast = answer.broadcasts.find((b) => b.id === broadcastId);
        if (!broadcast) return refused(BROADCAST_GONE);
        const refusal = broadcastRefusal(broadcast);
        return { broadcast, reasons: refusal ? [refusal] : [] };
      }
    }
  });

/** The YouTube stream the Stream Key pushes to, and why not, if none. */
const checkKeysStream = (streamKey: Option.Option<Redacted.Redacted<string>>) =>
  Effect.gen(function* () {
    // A missing key is its own reason.
    if (Option.isNone(streamKey)) return { streamId: null, reasons: [] };
    const answer = yield* findKeysStream(streamKey.value).pipe(
      Effect.catchTag("YouTubeLiveError", (e) =>
        Effect.succeed({ status: "failed" as const, message: e.message })
      )
    );
    const refused = (reason: string) => ({ streamId: null, reasons: [reason] });
    switch (answer.status) {
      case "found":
        return { streamId: answer.streamId, reasons: [] };
      case "no-match":
        return refused(NO_MATCHING_STREAM);
      case "needs-reconnect":
        return refused(RECONNECT_GOOGLE);
      case "failed":
        return refused(
          `Could not find the Stream Key's stream on YouTube: ${answer.message}`
        );
    }
  });

/**
 * Binds the Broadcast to the Stream Key's stream unless it already is, so
 * Matt never fixes the binding in YouTube Studio.
 */
const bindIfNeeded = (broadcast: Broadcast, streamId: string) =>
  broadcast.boundStreamId === streamId
    ? Effect.void
    : bindBroadcast({ broadcastId: broadcast.id, streamId }).pipe(
        Effect.catchTag("YouTubeLiveError", (e) => {
          const reason = `Could not bind the Broadcast to the Stream Key's stream: ${e.message}`;
          return Effect.fail(
            new GoLiveRefusedError({ reasons: [reason], message: reason })
          );
        })
      );

/** The saved Mic EQ, read once at Go Live as a Recording Session reads it. */
const savedMicEq = (db: Database) =>
  dbCall(() =>
    db.query.micEqSettings.findFirst({
      where: eq(micEqSettings.id, MIC_EQ_SETTING_ID),
    })
  ).pipe(
    Effect.map((row): MicEq =>
      row
        ? { lowDb: row.lowDb, midDb: row.midDb, highDb: row.highDb }
        : DEFAULT_MIC_EQ
    )
  );

export const goLive = Effect.fn("goLive")(function* (o: {
  db: Database;
  client: RecorderClient;
  videoId: string;
  /** The Broadcast picked on the Streaming tab; null: none. */
  broadcastId: string | null;
  silenceLength: SilenceLength;
  /** The folder (WSL path) the Recording Session's folder goes in. */
  folder: string;
  /** The `.env` the Stream Key is read from (default: the repo root's). */
  envPath?: string;
  now: Date;
}) {
  const { format } = yield* requireRecordableVideo(o.db, o.videoId);
  const streamKey = readStreamKey(o.envPath);
  const calibration = yield* Effect.either(
    requireFreshAVCalibration(o.db, o.now)
  );
  const [picked, keys] = yield* Effect.all(
    [checkBroadcast(o.broadcastId), checkKeysStream(streamKey)],
    { concurrency: "unbounded" }
  );
  const reasons = [
    ...new Set([...picked.reasons, ...keys.reasons]),
    ...(Option.isNone(streamKey) ? [STREAM_KEY_MISSING] : []),
    ...(Either.isLeft(calibration) ? [calibration.left.message] : []),
    ...o.client.goLiveRefusals(o.videoId, format),
  ];
  if (
    reasons.length > 0 ||
    picked.broadcast === null ||
    keys.streamId === null ||
    Option.isNone(streamKey) ||
    Either.isLeft(calibration)
  )
    return yield* new GoLiveRefusedError({
      reasons,
      message: reasons.join(" "),
    });
  yield* bindIfNeeded(picked.broadcast, keys.streamId);
  const { cameraDevice, recorderMic } = calibration.right;
  // The pair the gate checked: the recorder refuses any other at Record.
  const micOffsetMs =
    cameraDevice === null
      ? null
      : yield* pairMicOffsetMs(o.db, {
          camera: cameraDevice,
          mic: recorderMic,
        });
  const micEq = yield* savedMicEq(o.db);
  const broadcastId = picked.broadcast.id;
  yield* recorderCommand(() =>
    o.client.goLive(o.videoId, {
      broadcastId,
      streamKey: streamKey.value,
      micOffsetMs: micOffsetMs ?? DEFAULT_MIC_OFFSET_MS,
      micEq,
      silenceLength: o.silenceLength,
      folder: o.folder,
    })
  );
});

/** END STREAM on the app server. */
export const endStream = (client: RecorderClient, videoId: string) =>
  recorderCommand(() => client.endStream(videoId));
