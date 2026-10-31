import type { RecorderClient } from "./client.server";
import type { RecorderLiveStream } from "./live-stream-commands";

/**
 * Where the app server keeps its one recorder client (`live.server.ts`),
 * across dev-server module reloads.
 */
export const RECORDER_CLIENT_KEY = Symbol.for("cvm.recorder-client");

/**
 * The app server's recorder client if one was made, without making one: a
 * reader of the recorder's state never opens a socket of its own.
 */
export const existingRecorderClient = (): RecorderClient | undefined =>
  (globalThis as unknown as Record<symbol, RecorderClient | undefined>)[
    RECORDER_CLIENT_KEY
  ];

const LIVE_STREAM_LISTENERS_KEY = Symbol.for("cvm.live-stream-listeners");

/**
 * Who hears the Live Stream change (each tab's `/api/jobs/events`), kept
 * across module reloads like the client: the client tells them
 * (`live.server.ts`), whether or not it existed when they began listening.
 */
export const liveStreamListeners = (): Set<
  (liveStream: RecorderLiveStream | null) => void
> => {
  const store = globalThis as unknown as Record<
    symbol,
    Set<(liveStream: RecorderLiveStream | null) => void> | undefined
  >;
  return (store[LIVE_STREAM_LISTENERS_KEY] ??= new Set());
};
