import {
  currentSqlStatementTally,
  startSqlStatementTally,
  type SqlStatementTally,
} from "@cvm/core/db/sql-statement-tally";
import { Effect, FiberRef } from "effect";
import type { MiddlewareFunction } from "react-router";
import { log } from "@/packages/log";

/**
 * The slow-request log: one line in the server log for every route request
 * that takes longer than `SLOW_REQUEST_MS`, with how many SQL statements it
 * sent. It reports and never blocks — it is how slow DB loops, which no static
 * guard can tell from fast ones, get found and moved into a Job.
 *
 *   [cvm-slow-request] {"route":"/api/courses/abc/duplicate","method":"POST","ms":3412,"dbStatements":820,"outcome":"ok"}
 *
 * It runs once, as the root route's middleware (`slowRequestMiddleware`, in
 * `root.tsx`), so every request is timed: a page, a loader's data, a resource
 * route, whether or not it was built with `makeLoader` or `makeAction`.
 *
 * Long-lived streams are not requests that finished slowly, so they are left
 * out: any `text/event-stream` answer (SSE), the Job Event stream and the
 * teleprompter's poll.
 */
export const SLOW_REQUEST_MS = 2_000;
export const SLOW_REQUEST_PREFIX = "[cvm-slow-request]";

const EXCLUDED_PATHS = [/^\/api\/jobs\/events\b/, /^\/api\/teleprompter\//];

/**
 * Runs `effect` with `tally` current in every task Effect schedules for it and
 * its children, so statements sent after an async boundary still count against
 * this request rather than whichever request happened to wake the scheduler.
 */
export const tallyStatements = <A, E, R>(
  tally: SqlStatementTally,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.flatMap(FiberRef.get(FiberRef.currentScheduler), (inner) =>
    Effect.withScheduler(effect, {
      shouldYield: (fiber) => inner.shouldYield(fiber),
      scheduleTask: (task, priority, fiber) =>
        inner.scheduleTask(() => tally.run(task), priority, fiber),
    })
  );

/** `tallyStatements` with the tally the request's middleware opened. */
export const withRequestTally = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  const tally = currentSqlStatementTally();
  return tally ? tallyStatements(tally, effect) : effect;
};

const isEventStream = (value: unknown): boolean =>
  value instanceof Response &&
  (value.headers.get("content-type") ?? "").startsWith("text/event-stream");

export interface SlowRequestLogOptions {
  thresholdMs?: number;
  now?: () => number;
  write?: (line: string) => void;
}

/** Times `handle` and logs it if it ran past the threshold. */
export async function logSlowRequest<A>(
  request: Request,
  handle: (tally: SqlStatementTally) => Promise<A>,
  {
    thresholdMs = SLOW_REQUEST_MS,
    now = () => performance.now(),
    write = (line) => log.warn(line),
  }: SlowRequestLogOptions = {}
): Promise<A> {
  const route = new URL(request.url).pathname;
  const tally = startSqlStatementTally();
  if (EXCLUDED_PATHS.some((path) => path.test(route))) {
    return handle(tally);
  }

  const start = now();
  let outcome: "ok" | "threw" = "threw";
  let result: unknown;
  try {
    result = await tally.run(() => handle(tally));
    outcome = "ok";
    return result as A;
  } finally {
    const ms = Math.round(now() - start);
    if (ms > thresholdMs && !isEventStream(result)) {
      write(
        `${SLOW_REQUEST_PREFIX} ${JSON.stringify({
          route,
          method: request.method,
          ms,
          dbStatements: tally.count,
          outcome,
        })}`
      );
    }
  }
}

/** Times every request the app answers: the root route's middleware. */
export const makeSlowRequestMiddleware =
  (options: SlowRequestLogOptions = {}): MiddlewareFunction<Response> =>
  ({ request }, next) =>
    logSlowRequest(request, () => next(), options);

export const slowRequestMiddleware = makeSlowRequestMiddleware();
