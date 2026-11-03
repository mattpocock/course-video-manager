// First, before any module that reads the environment is evaluated.
import "./load-repo-env";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Deferred, Effect, Exit, Layer, Logger } from "effect";
import { resolveDatabaseUrl } from "@cvm/core/db/database-url";
import {
  formatConnectionRefusal,
  isReadOnlyConnection,
  judgeConnection,
} from "@cvm/core/db/connection-guard";
import { isInsideGitWorktree } from "@cvm/core/git-worktree";
import { leaveSignalsToTheProcess } from "@/services/ffmpeg-child-registry";
import { judgeServiceUrlOverrides } from "@/services/service-url-guard";
import { judgeStorageRootsOnDisk } from "@/services/storage-roots";
import { sidecarSocketPath } from "@/services/sidecar-socket.server";
import { sidecarLayer } from "./sidecar-layer";
import { JOB_KINDS, type JobServices } from "./job-kinds";
import { makeJsonLogger } from "./json-logger";
import { runSidecar, SIDECAR_TIMING, type SidecarIdentity } from "./sidecar";
import { serveSidecarSocket } from "./socket";
import { LocalWhisperEngine } from "@/services/local-whisper-engine";
import { sweepStuckClips } from "./stuck-clip-sweep";
import { sweepUnqueuedVoices } from "./clip-mockup-voice-sweep";
import { sweepMovePartials } from "./move-partials-sweep";
import { superviseSidecar } from "./supervise";
import {
  POSTING_QUEUE_TICK_MS,
  postingQueueTickIn,
} from "./posting-queue-tick";

/**
 * The sidecar's entry point (`pnpm dev` runs it as `dev:sidecar`, `pnpm start`
 * as `start:sidecar`), and its one Effect runtime boundary.
 *
 * EVERY EXIT IS 0. `pnpm dev` runs the app, the forwarder and this side by
 * side, and pnpm stops all of them when one fails — so a sidecar that must
 * not run here (a worktree pointed at production, a read-only connection,
 * a service URL override that would send a token elsewhere, another sidecar
 * holding the lease) says why, loudly, and gets out of the app's way.
 *
 * IT RESTARTS ITSELF. A run that ends any other way — a database outage that
 * lapsed its lease, a database it could not reach, a crash — runs again after
 * a wait that doubles up to 30 s (`superviseSidecar`), so Jobs never
 * stall behind a sidecar nobody restarted. Only a signal ends it. While it
 * is down the app says so on every page (`SidecarDownBanner`), and nothing
 * is lost: an enqueued Job is a row, and waits.
 */

const say = (message: string) =>
  process.stdout.write(`${new Date().toISOString()} [sidecar] ${message}\n`);

/** The checkout this file belongs to — its `.env`, `.data/` and git SHA. */
const CHECKOUT = path.resolve(import.meta.dirname, "../../..");

const gitSha = (): string => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: CHECKOUT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
};

/** Why the sidecar must not start here, or `undefined` when it may. */
const refusal = (): string | undefined => {
  const urls = judgeServiceUrlOverrides(process.env);
  if (urls.length > 0) {
    return `a service URL override would send production credentials to another host:\n${urls.map((r) => `  - ${r.message}`).join("\n")}`;
  }
  const storage = judgeStorageRootsOnDisk(process.env);
  if (storage.refusal) return storage.refusal;
  for (const root of storage.offline) {
    say(`Storage Root ${root} is offline: files on it will be "not found".`);
  }
  const url = resolveDatabaseUrl();
  if (!url) return "DATABASE_URL is not set, so there is no job table to read.";
  // The same rule every database client goes through (DrizzleService enforces
  // it again when it connects): a worktree never writes to a remote database.
  const verdict = judgeConnection({
    url,
    env: process.env,
    insideGitWorktree: () => isInsideGitWorktree(),
  });
  if (!verdict.allowed) return formatConnectionRefusal(verdict);
  // A read-only connection (verify-cvm's --production) cannot hold a lease.
  if (isReadOnlyConnection(url, process.env)) {
    return "the database connection is read-only, and the sidecar must write its lease and its Jobs.";
  }
  return undefined;
};

const main = async (): Promise<void> => {
  // The repo-root .env is already loaded: `./load-repo-env`, imported first.
  const refused = refusal();
  if (refused) {
    say(`not started: ${refused}`);
    return;
  }

  // Everything the run needs is read here, before any work starts.
  const socket = sidecarSocketPath();
  const logDir =
    process.env.CVM_SIDECAR_LOG_DIR ||
    path.join(CHECKOUT, ".data", "logs", "jobs");
  fs.mkdirSync(path.dirname(socket), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const identity = (): SidecarIdentity => ({
    // A fresh holder per run: what an ended run held is recovered, never
    // mistaken for this one's.
    holder: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    checkout: CHECKOUT,
    gitSha: gitSha(),
    socket,
  });

  // The sidecar owns its signals: a stop interrupts each running Job, whose
  // scope kills its ffmpeg, and the Job goes back to the queue. The registry's
  // own signal handler would SIGKILL ffmpeg first and re-raise the signal,
  // killing the process before any Job is put back.
  leaveSignalsToTheProcess();

  // The app server's own services and the Sidecar's alone (`sidecar-layer.ts`:
  // the encodes, the Overlay renderer, the export and Publish), built once in
  // this process (so ffmpeg's GPU/CPU permits are process-wide here too), on
  // the same guarded database client. `SidecarContext` is provided there and
  // nowhere else: work that has moved into a Job asks for it, so only the
  // sidecar can run it.
  const layer = Layer.mergeAll(
    sidecarLayer,
    Logger.replace(
      Logger.defaultLogger,
      makeJsonLogger({ logDir, write: (text) => process.stdout.write(text) })
    )
  );

  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const signalled = yield* Deferred.make<string>();
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        // A signal handler cannot wait; completing a Deferred is synchronous.
        process.once(signal, () =>
          Deferred.unsafeDone(signalled, Exit.succeed(signal))
        );
      }
      return yield* superviseSidecar({
        runOnce: (stop) =>
          Effect.flatMap(LocalWhisperEngine, (whisper) =>
            runSidecar<JobServices>({
              identity: identity(),
              registry: JOB_KINDS,
              timing: SIDECAR_TIMING,
              stop,
              // Each sweep on its own: one that fails never skips the other.
              // Only Matt's main checkout posts the Posting Queue.
              postingQueueTick: {
                tick: postingQueueTickIn(CHECKOUT),
                everyMs: POSTING_QUEUE_TICK_MS,
              },
              afterRecovery: sweepStuckClips.pipe(
                Effect.catchAllCause((cause) =>
                  Effect.logError("sidecar: the stuck-Clip sweep failed", cause)
                ),
                Effect.zipRight(sweepUnqueuedVoices),
                Effect.zipRight(sweepMovePartials)
              ),
              serve: (handle) =>
                serveSidecarSocket({
                  socket,
                  handle,
                  registry: JOB_KINDS,
                  logDir,
                  keepWhisperWarm: whisper.keepWarm,
                }),
            })
          ).pipe(Effect.provide(layer)),
        signalled,
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
        healthyAfterMs: 60_000,
        onRestart: ({ delayMs, why }) =>
          Effect.sync(() =>
            say(
              `NOT RUNNING — ${why}\nStarting again in ${delayMs / 1000} s. Jobs wait in the queue until then.`
            )
          ),
      });
    })
  );

  if (outcome._tag === "LeaseHeld") {
    const lease = outcome.lease;
    say(
      lease
        ? `not started: the sidecar in ${lease.checkout} (pid ${lease.pid} on ${lease.hostname}, ${lease.gitSha.slice(0, 7)}) holds the lease on database ${lease.database}. One sidecar runs per database.`
        : "not started: another sidecar holds this database's lease."
    );
    return;
  }
  say(`stopped: ${outcome.signal}`);
};

if (!process.env.VITEST) {
  main()
    .catch((error: unknown) =>
      say(`FAILED — the sidecar is not running.\n${String(error)}`)
    )
    .finally(() => {
      // The database pool's idle connections would hold the process open for
      // a while after the sidecar has stopped; nothing is left to wait for.
      setTimeout(() => process.exit(0), 250).unref();
    });
}
