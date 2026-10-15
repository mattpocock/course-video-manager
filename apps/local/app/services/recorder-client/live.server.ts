import { Effect } from "effect";
import { DEAD_DESK_URL, isMainCheckout } from "live-desk/live-desk";
import { RECORDER_SERVICE_PORT } from "recorder-service/protocol";
import { DrizzleService } from "@/services/drizzle-service.server";
import { runtimeLive } from "@/services/layer.server";
import { STORAGE_FOLDERS, writeFolder } from "@/packages/storage";
import { readStorageRootsSync } from "@/services/storage-roots";
import { lastPassedCalibrationNow } from "@/services/av-calibration.server";
import { createRecorderClient, type RecorderClient } from "./client.server";
import { keepWhisperWarm } from "@/services/sidecar-socket.server";
import { RECORDER_CLIENT_KEY } from "./existing-client.server";
import {
  ingestRecorderEvent,
  unfinishedRecordingSessions,
} from "./ingest.server";

/**
 * The app server's one recorder client, made on first use and kept across
 * dev-server module reloads (a second client would hear, and save, every
 * event twice). Its runs of `ingestRecorderEvent` are this module's: it is
 * the client's entry point, as a daemon's is.
 *
 * Only the main checkout talks to Matt's recorder service; any other
 * checkout gets the dead address, as its editor does for the Stream Deck hub
 * and OBS (live-desk/live-desk.ts). `RECORDER_SERVICE_URL` overrides both.
 */

const KEY = RECORDER_CLIENT_KEY;

const recorderServiceUrl = () =>
  process.env.RECORDER_SERVICE_URL ||
  (isMainCheckout(process.cwd())
    ? `ws://127.0.0.1:${RECORDER_SERVICE_PORT}`
    : DEAD_DESK_URL);

/**
 * The folder (WSL path) each Recording Session's folder goes in:
 * `raw-footage/` on the first Storage Root, beside the OBS recordings (ADR
 * 0040), never `~/Videos` on C:. AV Calibration runs go in its
 * `av-calibrations/`.
 */
export const recordingFolder = () =>
  writeFolder(readStorageRootsSync(), STORAGE_FOLDERS.rawFootage);

export const recorderClient = (): RecorderClient => {
  const store = globalThis as unknown as Record<
    symbol,
    RecorderClient | undefined
  >;
  const existing = store[KEY];
  if (existing) return existing;
  const client = createRecorderClient({
    url: recorderServiceUrl(),
    ingest: (event, askEditor) =>
      runtimeLive.runPromise(
        Effect.gen(function* () {
          const db = yield* DrizzleService;
          return yield* ingestRecorderEvent(db, event, askEditor);
        })
      ),
    // An editor answers at once (its SSE, then one POST); one that has not
    // in this long is not there.
    placeTimeoutMs: 5_000,
    unfinishedRecordingSessions: (candidates) =>
      runtimeLive.runPromise(
        Effect.gen(function* () {
          const db = yield* DrizzleService;
          return yield* unfinishedRecordingSessions(db, candidates);
        })
      ),
    calibration: () => runtimeLive.runPromise(lastPassedCalibrationNow),
    reconnectMs: 2_000,
    commandTimeoutMs: 30_000,
    // Long enough for a page reload not to close the camera and reopen it.
    closeGraceMs: 10_000,
    retryMs: 1_000,
    folder: recordingFolder(),
    keepWhisperWarm: (ms) =>
      void runtimeLive.runPromise(
        keepWhisperWarm(ms).pipe(
          // No Sidecar: nothing to keep warm, and nothing to transcribe.
          Effect.catchTag("SidecarUnreachableError", (e) =>
            Effect.logWarning(`Whisper not kept warm: ${e.message}`)
          )
        )
      ),
  });
  store[KEY] = client;
  return client;
};
