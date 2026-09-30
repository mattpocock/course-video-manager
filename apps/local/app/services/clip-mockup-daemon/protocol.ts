import { Schema } from "effect";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

/**
 * WHAT THE `cvm` PROCESS AND THE CLIP MOCKUP DAEMON AGREE ON: where the daemon
 * listens, which code it is running, and the shape of the two requests.
 *
 * WHY THERE IS A DAEMON AT ALL. Voicing a line needs Kokoro on the GPU, and
 * capturing a frame needs Chromium. Both are slow to START and fast to USE:
 * ~2s to load the model for a line that then takes 0.2s, and every model
 * loaded takes 1-3GB of an 8GB card. One `cvm` process per call paid the start
 * every time, and several at once ran the card out of memory and slowed every
 * one of them ~8x. So one long-lived process holds ONE model and ONE browser,
 * every `cvm clip-mockup` call on this machine sends it its work, and it stops
 * itself after five idle minutes. See ADR 0031.
 *
 * It is NOT a second path to the database. The daemon never reads or writes a
 * row; it turns HTML into PNGs and lines into WAVs, and `cvm` still writes
 * every row over the one HTTP transport to `apps/remote`.
 */

const here = nodePath.dirname(fileURLToPath(import.meta.url));

/** The launcher `cvm` spawns: plain Node, so it can pin tsx before it boots. */
export const DAEMON_LAUNCHER = nodePath.join(here, "daemon.mjs");

/**
 * EVERY FILE WHOSE CODE THE DAEMON RUNS, and so every file that decides what a
 * frame or a line sounds like. Their bytes are the daemon's VERSION.
 *
 * A daemon outlives the code it was started from: merge a change to the voice
 * and a daemon started this morning would keep voicing lines the old way for
 * as long as it was kept busy. So the socket is NAMED by this version. Changed
 * code is a different socket, the next call starts a fresh daemon on it, and
 * the old one stops itself after its idle time. Add a file here when the
 * daemon starts to run it.
 */
const VERSIONED_FILES = [
  "protocol.ts",
  "server.ts",
  "daemon.mjs",
  "../frame-capture-service.ts",
  "../clip-mockup-speech-service.ts",
  "../clip-mockup-speech-kokoro.ts",
  // Dependency versions: a new kokoro-js or Playwright is new behaviour too.
  "../../../package.json",
];

/**
 * The daemon version for the code in THIS checkout. The checkout's own path is
 * part of it, so two worktrees never share a daemon: each runs its own code.
 */
export const daemonVersion = (): string => {
  const hash = createHash("sha256").update(here);
  for (const file of VERSIONED_FILES) {
    hash.update("\0").update(readFileSync(nodePath.join(here, file)));
  }
  return hash.digest("hex").slice(0, 16);
};

/** Where the daemons of this machine keep their sockets, locks and logs. */
const DAEMON_DIR = nodePath.join(
  os.homedir(),
  ".cache",
  "cvm",
  "clip-mockup-daemon"
);

export interface DaemonPaths {
  readonly dir: string;
  /** The Unix socket the daemon listens on. */
  readonly socket: string;
  /** Held by the one daemon of this version; it stops a second one starting. */
  readonly lock: string;
  /** The daemon's stdout and stderr — onnxruntime and Chromium write here. */
  readonly log: string;
}

export const daemonPaths = (version: string): DaemonPaths => ({
  dir: DAEMON_DIR,
  socket: nodePath.join(DAEMON_DIR, `${version}.sock`),
  lock: nodePath.join(DAEMON_DIR, `${version}.lock`),
  log: nodePath.join(DAEMON_DIR, `${version}.log`),
});

/** A daemon stops itself after this long with no request in progress. */
export const DAEMON_IDLE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// The two requests. Paths are absolute: the daemon and `cvm` are on one
// machine, so `cvm` names where each file goes and the daemon writes it there.
// ---------------------------------------------------------------------------

export const CaptureRequest = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      htmlPath: Schema.String,
      outputPath: Schema.String,
      fullPage: Schema.Boolean,
    })
  ),
});
export type CaptureRequest = typeof CaptureRequest.Type;

export const SpeakRequest = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({ line: Schema.String, outputPath: Schema.String })
  ),
});
export type SpeakRequest = typeof SpeakRequest.Type;

/** A request that failed carries the one message the agent needs to read. */
const Failed = Schema.Struct({
  ok: Schema.Literal(false),
  message: Schema.String,
});

/** A failed capture also names the page, which is what the agent must fix. */
export const CaptureResponse = Schema.Union(
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ...Failed.fields, htmlPath: Schema.String })
);

/** One duration per item, in the order the items were sent. */
export const SpeakResponse = Schema.Union(
  Schema.Struct({
    ok: Schema.Literal(true),
    durationsSeconds: Schema.Array(Schema.Number),
  }),
  Failed
);

export const VersionResponse = Schema.Struct({
  version: Schema.String,
  pid: Schema.Number,
});
