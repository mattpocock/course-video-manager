import { Effect } from "effect";
import { isMainCheckout } from "live-desk/live-desk";
import { DrizzleService } from "@/services/drizzle-service.server";
import { runtimeLive } from "@/services/layer.server";
import { STORAGE_FOLDERS, writeFolder } from "@/packages/storage";
import { readStorageRootsSync } from "@/services/storage-roots";
import { lastPassedCalibrationNow } from "@/services/av-calibration.server";
import { createRecorderClient, type RecorderClient } from "./client.server";
import { keepWhisperWarm } from "@/services/sidecar-socket.server";
import { broadcastChat } from "@/services/broadcast-chat-live.server";
import {
  liveStreamListeners,
  RECORDER_CLIENT_KEY,
} from "./existing-client.server";
import {
  REAL_RECORDER_SERVICE_URL,
  recorderServiceUrl,
} from "./recorder-service-url";
import { recorderServiceProcess } from "./service-process.server";
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
 * Only Matt's own app server, in his main checkout, talks to his recorder
 * service; an agent's server (any checkout) and every other checkout get the
 * dead address (`recorder-service-url.ts`). So only Matt's own app server
 * starts his recorder service, on demand (`service-on-demand.ts`, ADR 0053).
 */

const KEY = RECORDER_CLIENT_KEY;

/**
 * The folder (WSL path) each Recording Session's folder goes in:
 * `raw-footage/` on the first Storage Root, beside the old OBS recordings (ADR
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
  const mainCheckout = isMainCheckout(process.cwd());
  const url = recorderServiceUrl({
    env: process.env,
    mainCheckout: () => mainCheckout,
  });
  const client = createRecorderClient({
    url,
    // Never an agent's server (#2292: it gets the dead address) or a worktree's.
    launcher:
      mainCheckout && url === REAL_RECORDER_SERVICE_URL
        ? recorderServiceProcess
        : undefined,
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
    // The Live indicator in every tab follows it, however it ends.
    onLiveStreamChanged: (liveStream) => {
      for (const listener of liveStreamListeners()) listener(liveStream);
    },
    // Chat is read from the pick until the streamed Recording Session ends.
    onStreamedSessionEnded: () => broadcastChat().end(),
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
