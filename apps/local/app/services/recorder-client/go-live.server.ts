import { Data, Effect, Either, Option } from "effect";
import { eq } from "drizzle-orm";
import { micEqSettings } from "@/db/schema";
import {
  DEFAULT_MIC_EQ,
  DEFAULT_MIC_OFFSET_MS,
  MIC_EQ_SETTING_ID,
  type MicEq,
} from "@cvm/core/features/videos/recorder";
import type { SilenceLength } from "@/silence-detection-constants";
import { broadcastRefusal } from "@/features/streaming/broadcast";
import { dbCall } from "@/services/clip-service-handler.helpers";
import type { Database } from "@/services/drizzle-service.server";
import {
  pairMicOffsetMs,
  requireFreshAVCalibration,
} from "@/services/av-calibration.server";
import { listBroadcasts } from "@/services/youtube-live-service";
import {
  readStreamKey,
  STREAM_KEY_MISSING,
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

/** Why the picked Broadcast can't be streamed to, if it can't. */
const broadcastReasons = (broadcastId: string | null) =>
  Effect.gen(function* () {
    if (broadcastId === null) return [NO_BROADCAST];
    const answer = yield* listBroadcasts.pipe(
      Effect.catchTag("YouTubeLiveError", (e) =>
        Effect.succeed({ status: "failed" as const, message: e.message })
      )
    );
    switch (answer.status) {
      case "failed":
        return [
          `Could not check the Broadcast with YouTube: ${answer.message}`,
        ];
      case "needs-reconnect":
        return [RECONNECT_GOOGLE];
      case "listed": {
        const broadcast = answer.broadcasts.find((b) => b.id === broadcastId);
        if (!broadcast) return [BROADCAST_GONE];
        const refusal = broadcastRefusal(broadcast);
        return refusal ? [refusal] : [];
      }
    }
  });

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
  const reasons = [
    ...(yield* broadcastReasons(o.broadcastId)),
    ...(Option.isNone(streamKey) ? [STREAM_KEY_MISSING] : []),
    ...(Either.isLeft(calibration) ? [calibration.left.message] : []),
    ...o.client.goLiveRefusals(o.videoId, format),
  ];
  if (
    reasons.length > 0 ||
    o.broadcastId === null ||
    Option.isNone(streamKey) ||
    Either.isLeft(calibration)
  )
    return yield* new GoLiveRefusedError({
      reasons,
      message: reasons.join(" "),
    });
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
  const { broadcastId } = o;
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
