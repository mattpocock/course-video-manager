import type { RecorderClient } from "./client.server";

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
