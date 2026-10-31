import { Data, Effect, Either, Redacted } from "effect";
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
  completeBroadcast,
  findKeysStream,
  listBroadcasts,
  YouTubeLiveError,
} from "@/services/youtube-live-service";
import {
  readStreamKey,
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

/**
 * A YouTube call Go Live makes, its failure turned into Go Live's reason:
 * `what` is what CVM could not do ("Could not … with YouTube: <message>").
 */
const orReason = <A, E, R>(
  call: Effect.Effect<A, E | YouTubeLiveError, R>,
  what: string
) =>
  call.pipe(
    Effect.mapError((e) => {
      if (!(e instanceof YouTubeLiveError)) return e;
      const reason = `${what}: ${e.message}`;
      return new GoLiveRefusedError({ reasons: [reason], message: reason });
    })
  );

/** A check's answer when it refuses: no value, and the reasons. */
const refusedWith = (e: GoLiveRefusedError) =>
  Effect.succeed({ value: null, reasons: e.reasons });

/** The picked Broadcast, and why it can't be streamed to, if it can't. */
const checkBroadcast = (broadcastId: string | null) =>
  Effect.gen(function* () {
    const refused = (reason: string) => ({ value: null, reasons: [reason] });
    if (broadcastId === null) return refused(NO_BROADCAST);
    const answer = yield* orReason(
      listBroadcasts,
      "Could not check the Broadcast with YouTube"
    );
    if (answer.status === "needs-reconnect") return refused(RECONNECT_GOOGLE);
    const broadcast = answer.broadcasts.find((b) => b.id === broadcastId);
    if (!broadcast) return refused(BROADCAST_GONE);
    const refusal = broadcastRefusal(broadcast);
    return { value: broadcast, reasons: refusal ? [refusal] : [] };
  }).pipe(Effect.catchTag("GoLiveRefusedError", refusedWith));

/** The YouTube stream the Stream Key pushes to, and why not, if none. */
const checkKeysStream = (
  streamKey: Either.Either<Redacted.Redacted<string>, string>
) =>
  Effect.gen(function* () {
    const refused = (reason: string) => ({ value: null, reasons: [reason] });
    // No key is its own reason.
    if (Either.isLeft(streamKey)) return refused(streamKey.left);
    const answer = yield* orReason(
      findKeysStream(streamKey.right),
      "Could not find the Stream Key's stream on YouTube"
    );
    switch (answer.status) {
      case "found":
        return { value: answer.streamId, reasons: [] };
      case "no-match":
        return refused(NO_MATCHING_STREAM);
      case "needs-reconnect":
        return refused(RECONNECT_GOOGLE);
    }
  }).pipe(Effect.catchTag("GoLiveRefusedError", refusedWith));

/**
 * Binds the Broadcast to the Stream Key's stream unless it already is, so
 * Matt never fixes the binding in YouTube Studio.
 */
const bindIfNeeded = (broadcast: Broadcast, streamId: string) =>
  broadcast.boundStreamId === streamId
    ? Effect.void
    : orReason(
        bindBroadcast({ broadcastId: broadcast.id, streamId }),
        "Could not bind the Broadcast to the Stream Key's stream"
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
  /** The `.env` the Stream Key is read from: `repoEnvPath()`, undefined when there is none. */
  envPath: string | undefined;
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
  // A check that refuses gives no value; one that passes, no reasons.
  const reasons = [
    ...new Set([...picked.reasons, ...keys.reasons]),
    ...(Either.isLeft(calibration) ? [calibration.left.message] : []),
    ...o.client.goLiveRefusals(o.videoId, format),
  ];
  if (
    reasons.length > 0 ||
    picked.value === null ||
    keys.value === null ||
    Either.isLeft(streamKey) ||
    Either.isLeft(calibration)
  )
    return yield* new GoLiveRefusedError({
      reasons,
      message: reasons.join(" "),
    });
  yield* bindIfNeeded(picked.value, keys.value);
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
  const broadcastId = picked.value.id;
  yield* recorderCommand(() =>
    o.client.goLive(o.videoId, {
      broadcastId,
      streamKey: streamKey.right,
      micOffsetMs: micOffsetMs ?? DEFAULT_MIC_OFFSET_MS,
      micEq,
      silenceLength: o.silenceLength,
      folder: o.folder,
    })
  );
});

/**
 * END STREAM on the app server: once the push has stopped, the Broadcast is
 * completed, so it ends now and not a minute later by auto-stop. The stream
 * has ended either way: a refused transition is only logged, and auto-stop
 * still ends the Broadcast.
 */
export const endStream = (client: RecorderClient, videoId: string) =>
  Effect.gen(function* () {
    const { broadcastId } = yield* recorderCommand(() =>
      client.endStream(videoId)
    );
    yield* completeBroadcast(broadcastId).pipe(
      Effect.catchTag("YouTubeLiveError", (e) =>
        Effect.logWarning(
          `End Stream: could not complete the Broadcast with YouTube, so auto-stop ends it: ${e.message}`
        )
      )
    );
  });
