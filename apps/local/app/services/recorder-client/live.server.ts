import { Effect } from "effect";
import { homedir } from "node:os";
import path from "node:path";
import { DEAD_DESK_URL, isMainCheckout } from "live-desk/live-desk";
import { RECORDER_SERVICE_PORT } from "recorder-service/protocol";
import { DrizzleService } from "@/services/drizzle-service.server";
import { runtimeLive } from "@/services/layer.server";
import { createRecorderClient, type RecorderClient } from "./client.server";
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

const KEY = Symbol.for("cvm.recorder-client");

const recorderServiceUrl = () =>
  process.env.RECORDER_SERVICE_URL ||
  (isMainCheckout(process.cwd())
    ? `ws://127.0.0.1:${RECORDER_SERVICE_PORT}`
    : DEAD_DESK_URL);

/** The folder (WSL path) each Recording Session's folder goes in: beside the OBS recordings. */
export const recordingFolder = () =>
  process.env.OBS_RECORDING_DIR || path.join(homedir(), "Videos");

export const recorderClient = (): RecorderClient => {
  const store = globalThis as unknown as Record<
    symbol,
    RecorderClient | undefined
  >;
  const existing = store[KEY];
  if (existing) return existing;
  const client = createRecorderClient({
    url: recorderServiceUrl(),
    ingest: (event, insertionPointFor) =>
      runtimeLive.runPromise(
        Effect.gen(function* () {
          const db = yield* DrizzleService;
          return yield* ingestRecorderEvent(db, event, insertionPointFor);
        })
      ),
    unfinishedRecordingSessions: () =>
      runtimeLive.runPromise(
        Effect.gen(function* () {
          const db = yield* DrizzleService;
          return yield* unfinishedRecordingSessions(db);
        })
      ),
    reconnectMs: 2_000,
    commandTimeoutMs: 30_000,
    // Long enough for a page reload not to close the camera and reopen it.
    closeGraceMs: 10_000,
    retryMs: 1_000,
    folder: recordingFolder(),
  });
  store[KEY] = client;
  return client;
};
