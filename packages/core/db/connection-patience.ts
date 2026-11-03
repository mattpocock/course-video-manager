import type { Pool, PoolClient, QueryConfig } from "pg";

/**
 * PATIENCE: how a pool used by a caller that can wait (a Sidecar Job, a
 * Publish first) rides out a network drop (#2621). On 2026-11-02 DNS for the
 * database failed for a moment an hour into a Publish, and every query failed
 * on its first try.
 *
 * It retries only what cannot double-apply:
 * - **Opening a connection** that fails with a network error, for any
 *   statement, in a transaction or not: nothing has reached the server.
 * - **A `select` outside a transaction** whose connection drops mid-flight:
 *   reading twice changes nothing.
 *
 * Never a write, or a statement inside a transaction, cut off mid-flight: the
 * server may already have applied it. Never an SQL error. Those fail as they
 * always did. Waits grow from `firstDelayMs`, double, stop growing at
 * `maxDelayMs`, and the pool gives up once `windowMs` has passed since the
 * call began.
 */
export interface DbPatience {
  readonly windowMs: number;
  readonly firstDelayMs?: number;
  readonly maxDelayMs?: number;
}

/** Node's codes for a network that is not there, or went away. */
const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
]);

/**
 * SQLSTATEs that mean the connection, not the statement, failed: class 08
 * (connection exception), and the server shutting down or not yet up.
 */
const isConnectionSqlState = (code: string) =>
  code.startsWith("08") || ["57P01", "57P02", "57P03"].includes(code);

/** What `pg` says, in its own words, when the connection itself failed. */
const CONNECTION_MESSAGES = [
  /Connection terminated/i,
  /timeout exceeded when trying to connect/i,
];

/** Whether `error` (or anything it wraps) is the network, not the SQL. */
export const isConnectionFailure = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  const visit = (e: unknown): boolean => {
    if (typeof e !== "object" || e === null || seen.has(e)) return false;
    seen.add(e);
    const { code, message, cause, errors } = e as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof code === "string") {
      if (NETWORK_CODES.has(code) || isConnectionSqlState(code)) return true;
    }
    if (
      typeof message === "string" &&
      CONNECTION_MESSAGES.some((pattern) => pattern.test(message))
    ) {
      return true;
    }
    return (
      visit(cause) || (Array.isArray(errors) && errors.some((x) => visit(x)))
    );
  };
  return visit(error);
};

/** A statement that only reads, so may be sent again: a bare `select`. */
const isReadOnly = (statement: unknown) => {
  const text =
    typeof statement === "string"
      ? statement
      : (statement as QueryConfig | undefined)?.text;
  return typeof text === "string" && /^\s*select\b/i.test(text);
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Run `attempt` until it succeeds, `retry` says no, or `deadline` passes. */
const keepTrying = async <A>(
  patience: DbPatience,
  deadline: number,
  attempt: () => Promise<A>,
  retry: (error: unknown) => boolean
): Promise<A> => {
  let delayMs = patience.firstDelayMs ?? 250;
  const maxDelayMs = patience.maxDelayMs ?? 10_000;
  while (true) {
    try {
      return await attempt();
    } catch (error) {
      const left = deadline - Date.now();
      if (!retry(error) || left <= 0) throw error;
      console.error(
        `[db] the database is unreachable (${error instanceof Error ? error.message : String(error)}); trying again in ${Math.min(delayMs, left)} ms`
      );
      await sleep(Math.min(delayMs, left));
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }
};

/**
 * Make `pool` patient, in place: it stays a `Pool` (Drizzle's transactions
 * check `instanceof Pool`). Only the promise forms change, which are what
 * Drizzle calls; `pg-pool`'s own callback calls go through untouched.
 */
export const makePatient = (pool: Pool, patience: DbPatience): Pool => {
  const connectOnce = pool.connect.bind(pool);
  const queryOnce = pool.query.bind(pool);

  const connect = (deadline: number) =>
    keepTrying(patience, deadline, () => connectOnce(), isConnectionFailure);

  const patientConnect = (...args: unknown[]) =>
    args.length > 0
      ? (connectOnce as (...a: unknown[]) => unknown)(...args)
      : connect(Date.now() + patience.windowMs);

  const patientQuery = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === "function")) {
      return (queryOnce as (...a: unknown[]) => unknown)(...args);
    }
    const [statement, values] = args;
    const readOnly = isReadOnly(statement);
    const deadline = Date.now() + patience.windowMs;
    return keepTrying(
      patience,
      deadline,
      async () => {
        const client: PoolClient = await connect(deadline);
        let failure: Error | undefined;
        try {
          return await (client.query as (...a: unknown[]) => Promise<unknown>)(
            statement,
            values
          );
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
          throw error;
        } finally {
          // As pg-pool's own `query` does: a client that failed is dropped.
          client.release(failure);
        }
      },
      (error) => readOnly && isConnectionFailure(error)
    );
  };

  // The two overloaded methods, replaced by functions that keep their
  // contracts: TypeScript cannot check an overload set against a rest-args
  // function, so each is asserted to its own type.
  pool.connect = patientConnect as Pool["connect"];
  pool.query = patientQuery as Pool["query"];
  return pool;
};
