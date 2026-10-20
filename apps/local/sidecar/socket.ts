import fs from "node:fs";
import http from "node:http";
import { Data, Effect, Option, Queue, Runtime, Schema } from "effect";
import {
  JobOperationsService,
  type JobEvent,
  type JobEventWithJob,
  type JobSummary,
} from "@cvm/core/services/db-job-operations.server";
import { assertUnderEffect } from "@/services/assert-under";
import {
  JOB_STREAM_EVENTS,
  type JobEventMessage,
  type JobSnapshotMessage,
  type WireJob,
  type WireJobEvent,
} from "@/features/jobs/job-wire";
import { enqueueJob, type JobKindRegistry } from "./job-kinds";
import { jobLogPath } from "./json-logger";
import type { SidecarHandle } from "./sidecar";

/**
 * The sidecar's socket: HTTP over a Unix socket at `<checkout>/.data/sidecar.sock`
 * (or `CVM_SIDECAR_SOCKET`). A Unix socket, never a TCP port, so it can never
 * take a port in the CVM's 5170-5199 band or verify-cvm's 5200-5299, and two
 * checkouts never meet on it.
 *
 *   GET  /health     who this sidecar is, its database and its lanes
 *   POST /nudge      look for work now (an enqueue elsewhere calls this)
 *   POST /jobs       {kind, title, params, dependsOn?} → enqueue, then nudge
 *   GET  /jobs/<id>  the Job and its events
 *   GET  /jobs/<id>/log  the Job's log, one JSON object per line
 *   GET  /events     Job Events as Server-Sent Events (see features/jobs/job-wire.ts):
 *                    a snapshot, or a replay after `Last-Event-ID`, then live
 */

/**
 * How long a succeeded Job stays in a new subscriber's snapshot when the
 * author never dismissed it. A failed or interrupted Job needs the author,
 * so it stays until they dismiss it (`listRecentJobs`).
 */
export const SNAPSHOT_FINISHED_WITHIN_MS = 24 * 60 * 60_000;
/** A reconnect further behind than this gets a snapshot instead of a replay. */
const MAX_REPLAY = 5_000;
const KEEPALIVE_MS = 15_000;

const toWireJob = (job: JobSummary): WireJob => ({
  id: job.id,
  kind: job.kind,
  title: job.title,
  attempt: job.attempt,
  maxAttempts: job.maxAttempts,
  subjectType: job.subjectType,
  subjectId: job.subjectId,
  createdAt: job.createdAt.toISOString(),
});

const toWireEvent = (event: JobEvent): WireJobEvent => ({
  id: event.id,
  jobId: event.jobId,
  type: event.type,
  data: (event.data ?? {}) as Record<string, unknown>,
  at: event.at.toISOString(),
});

const sseMessage = (event: string, data: unknown, id?: number) =>
  `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const jobEventMessage = (row: JobEventWithJob) =>
  sseMessage(
    JOB_STREAM_EVENTS.jobEvent,
    {
      job: toWireJob(row.job),
      event: toWireEvent(row.event),
    } satisfies JobEventMessage,
    row.event.id
  );

/**
 * One subscriber's stream, until the scope closes (its connection does).
 * Subscribes BEFORE reading the snapshot or the replay, so nothing written in
 * between is lost; an event that arrives both ways is ignored the second time
 * by the jobs reducer.
 */
const streamJobEvents = (opts: {
  readonly handle: SidecarHandle;
  readonly lastEventId: number | null;
  readonly write: (text: string) => void;
}) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const live = yield* opts.handle.feed.subscribe;

    const replay =
      opts.lastEventId === null
        ? null
        : yield* ops.listJobEventsAfter({
            after: opts.lastEventId,
            limit: MAX_REPLAY + 1,
          });
    if (replay !== null && replay.length <= MAX_REPLAY) {
      for (const row of replay) opts.write(jobEventMessage(row));
    } else {
      const cursor = yield* ops.latestJobEventId();
      const recent = yield* ops.listRecentJobs({
        finishedWithinMs: SNAPSHOT_FINISHED_WITHIN_MS,
      });
      opts.write(
        sseMessage(
          JOB_STREAM_EVENTS.snapshot,
          {
            cursor,
            jobs: recent.map((r) => ({
              job: toWireJob(r.job),
              events: r.events.map(toWireEvent),
            })),
          } satisfies JobSnapshotMessage,
          cursor
        )
      );
    }

    while (true) {
      const batch = yield* Queue.take(live).pipe(
        Effect.timeoutOption(KEEPALIVE_MS)
      );
      if (Option.isNone(batch)) {
        // A comment line: keeps proxies and the browser from timing it out.
        opts.write(": keepalive\n\n");
        continue;
      }
      for (const row of batch.value) opts.write(jobEventMessage(row));
    }
  }).pipe(Effect.scoped);

export class SidecarSocketError extends Data.TaggedError("SidecarSocketError")<{
  readonly socket: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Linux's limit on a socket path (sun_path), less the terminating NUL. */
export const MAX_SOCKET_PATH_BYTES = 107;

const EnqueueRequest = Schema.Struct({
  kind: Schema.String,
  title: Schema.String,
  params: Schema.optionalWith(Schema.Unknown, { default: () => ({}) }),
  dependsOn: Schema.optionalWith(Schema.NullOr(Schema.String), {
    default: () => null,
  }),
});

class BadRequestError extends Data.TaggedError("BadRequestError")<{
  readonly message: string;
}> {}

const readBody = (req: http.IncomingMessage) =>
  Effect.async<string, BadRequestError>((resume) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () =>
      resume(Effect.succeed(Buffer.concat(chunks).toString("utf8")))
    );
    req.on("error", (error) =>
      resume(Effect.fail(new BadRequestError({ message: String(error) })))
    );
  });

const parseJson = (text: string) =>
  Effect.try({
    try: (): unknown => (text.trim() === "" ? {} : JSON.parse(text)),
    catch: () => new BadRequestError({ message: "the body is not JSON" }),
  });

/** Is something already answering on `socket`? */
const socketAnswers = (socket: string) =>
  Effect.async<boolean>((resume) => {
    const req = http.get({
      socketPath: socket,
      path: "/health",
      timeout: 1_000,
    });
    req.on("response", (res) => {
      res.resume();
      resume(Effect.succeed(true));
    });
    req.on("timeout", () => {
      req.destroy();
      resume(Effect.succeed(false));
    });
    req.on("error", () => resume(Effect.succeed(false)));
  });

/** The longest one keep-warm lease may hold Whisper loaded. */
const MAX_WHISPER_WARM_MS = 10 * 60_000;

/**
 * Listen on `socket` for as long as the scope lives. Refuses a path too long
 * for a socket, and a socket another live process still answers on; a socket
 * file left by a dead one is replaced.
 */
export const serveSidecarSocket = (opts: {
  readonly socket: string;
  readonly handle: SidecarHandle;
  readonly registry: JobKindRegistry<unknown>;
  /** Where the Jobs' log files are (`json-logger.ts`). */
  readonly logDir: string;
  /**
   * Keeps Local Whisper loaded for at least this many ms
   * (`/whisper/keep-warm`); without it the route does nothing (tests).
   */
  readonly keepWhisperWarm?: (ms: number) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const { socket, handle, registry, logDir } = opts;
    if (Buffer.byteLength(socket) > MAX_SOCKET_PATH_BYTES) {
      return yield* new SidecarSocketError({
        socket,
        message: `the socket path is ${Buffer.byteLength(socket)} bytes; a Unix socket allows ${MAX_SOCKET_PATH_BYTES}. Set CVM_SIDECAR_SOCKET to a shorter path.`,
      });
    }
    if (fs.existsSync(socket)) {
      if (yield* socketAnswers(socket)) {
        return yield* new SidecarSocketError({
          socket,
          message: `another process already answers on ${socket}`,
        });
      }
      fs.rmSync(socket, { force: true });
    }

    const runtime = yield* Effect.runtime<JobOperationsService>();
    const run = Runtime.runPromiseExit(runtime);

    const route = (
      req: http.IncomingMessage
    ): Effect.Effect<
      { status: number; body: unknown },
      unknown,
      JobOperationsService
    > =>
      Effect.gen(function* () {
        const url = req.url ?? "/";
        if (req.method === "GET" && url === "/health") {
          return { status: 200, body: yield* handle.health };
        }
        if (req.method === "POST" && url === "/nudge") {
          yield* handle.nudge;
          return { status: 200, body: { ok: true } };
        }
        // The recorder, while open, holds Whisper loaded (#2214): a lease
        // it renews, so an app server that dies pins no VRAM for long.
        const warm = /^\/whisper\/keep-warm\?ms=(\d+)$/.exec(url);
        if (req.method === "POST" && warm?.[1]) {
          if (opts.keepWhisperWarm)
            yield* opts.keepWhisperWarm(
              Math.min(Number(warm[1]), MAX_WHISPER_WARM_MS)
            );
          return { status: 200, body: { ok: true } };
        }
        if (req.method === "POST" && url === "/jobs") {
          const request = yield* readBody(req).pipe(
            Effect.flatMap(parseJson),
            Effect.flatMap(Schema.decodeUnknown(EnqueueRequest))
          );
          const job = yield* enqueueJob({
            id: null,
            kind: request.kind,
            title: request.title,
            params: request.params,
            dependsOn: request.dependsOn,
            subject: null,
            attemptsSpent: 0,
            registry,
          });
          yield* handle.nudge;
          return { status: 201, body: { ok: true, job } };
        }
        const logMatch = /^\/jobs\/([^/?]+)\/log$/.exec(url);
        if (req.method === "GET" && logMatch?.[1]) {
          const id = decodeURIComponent(logMatch[1]);
          const file = yield* assertUnderEffect(logDir, jobLogPath(logDir, id));
          if (!fs.existsSync(file)) {
            return {
              status: 404,
              body: { ok: false, message: `no log for job ${id}` },
            };
          }
          return {
            status: 200,
            body: { ok: true, log: fs.readFileSync(file, "utf8") },
          };
        }
        const jobMatch = /^\/jobs\/([^/?]+)$/.exec(url);
        if (req.method === "GET" && jobMatch?.[1]) {
          const ops = yield* JobOperationsService;
          const id = decodeURIComponent(jobMatch[1]);
          const job = yield* ops.getJob(id);
          if (!job)
            return {
              status: 404,
              body: { ok: false, message: `no job ${id}` },
            };
          return {
            status: 200,
            body: { ok: true, job, events: yield* ops.listJobEvents(id) },
          };
        }
        return {
          status: 404,
          body: { ok: false, message: `no such request: ${req.method} ${url}` },
        };
      }).pipe(
        Effect.catchTags({
          BadRequestError: (e) =>
            Effect.succeed({
              status: 400,
              body: { ok: false, message: e.message },
            }),
          ParseError: (e) =>
            Effect.succeed({
              status: 400,
              body: { ok: false, message: e.message },
            }),
          UnknownJobKindError: (e) =>
            Effect.succeed({
              status: 400,
              body: { ok: false, message: e.message },
            }),
          PathOutsideBaseDirError: (e) =>
            Effect.succeed({
              status: 400,
              body: { ok: false, message: e.message },
            }),
          NoAttemptsLeftError: (e) =>
            Effect.succeed({
              status: 400,
              body: { ok: false, message: e.message },
            }),
        }),
        Effect.tapErrorCause((cause) =>
          Effect.logError(`socket: ${req.method} ${req.url} failed`, cause)
        )
      );

    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        // Now, not with the first event: a reconnect with nothing to replay
        // writes nothing until the next event, and the app's proxy, waiting
        // 3 s for an answer, took the sidecar for down.
        res.flushHeaders();
        const header = req.headers["last-event-id"];
        const lastEventId =
          typeof header === "string" && /^\d+$/.test(header)
            ? Number(header)
            : null;
        // The stream runs until the subscriber goes away.
        const gone = new AbortController();
        res.on("close", () => gone.abort());
        void run(
          streamJobEvents({
            handle,
            lastEventId,
            write: (text) => {
              res.write(text);
            },
          }).pipe(
            Effect.tapErrorCause((cause) =>
              Effect.logError("socket: a Job Event stream failed", cause)
            )
          ),
          { signal: gone.signal }
        ).then(() => res.end());
        return;
      }
      // runPromiseExit never rejects, and node's request callback cannot wait.
      void run(route(req)).then((exit) => {
        const answer =
          exit._tag === "Success"
            ? exit.value
            : {
                status: 500,
                body: { ok: false, message: "the sidecar failed; see its log" },
              };
        res.writeHead(answer.status, { "content-type": "application/json" });
        res.end(JSON.stringify(answer.body));
      });
    });

    yield* Effect.async<void, SidecarSocketError>((resume) => {
      server.once("error", (cause) =>
        resume(
          Effect.fail(
            new SidecarSocketError({ socket, message: String(cause), cause })
          )
        )
      );
      server.listen(socket, () => resume(Effect.void));
    });
    yield* Effect.addFinalizer(() =>
      Effect.async<void>((resume) => {
        server.close(() => resume(Effect.void));
        server.closeAllConnections();
      }).pipe(
        Effect.zipRight(Effect.sync(() => fs.rmSync(socket, { force: true }))),
        Effect.zipRight(Effect.logInfo("sidecar: socket closed"))
      )
    );
    yield* Effect.logInfo(`sidecar: listening on ${socket}`);
  });
