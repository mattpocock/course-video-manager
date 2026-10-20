import { Config, Data, Duration, Effect, Schedule } from "effect";

/**
 * Why a request never got an HTTP answer. `"connection"`: the socket failed
 * or dropped — undici's `fetch failed`, ECONNRESET, ETIMEDOUT, a body cut off
 * mid-read. `"timeout"`: it outlived `requestTimeout`. Both are retried.
 */
export type DropboxNetworkFailure = "connection" | "timeout";

export class DropboxApiError extends Data.TaggedError("DropboxApiError")<{
  message: string;
  status?: number;
  endpoint?: string;
  network?: DropboxNetworkFailure;
  cause?: unknown;
}> {}

const isTransientStatus = (status: number) =>
  status === 429 || (status >= 500 && status <= 599);

const isRetryable = (error: DropboxApiError) =>
  error.network !== undefined || isTransientStatus(error.status ?? 0);

const MAX_RETRIES = 5;

const retrySchedule = Schedule.intersect(
  Schedule.exponential(Duration.seconds(1)),
  Schedule.recurs(MAX_RETRIES)
);

/** What any request gets before its body is counted. */
const REQUEST_BASE_TIMEOUT_MS = 2 * 60_000;
/**
 * The slowest uplink still called working: 256 KiB/s, about 2 Mbit/s. A
 * request carrying bytes gets the time this rate needs to send them.
 */
const SLOWEST_UPLOAD_BYTES_PER_SECOND = 256 * 1024;

/**
 * How long one request may take, start to last response byte, before it is
 * abandoned and retried: two minutes, plus its body at 256 KiB/s. A 16 MB
 * session chunk gets about three minutes, a 150 MB single-shot upload about
 * twelve. Size-aware rather than idle-based, because `fetch` reports nothing
 * while a buffered body is going up, so there is no stall to watch for.
 */
export const requestTimeout = (bodyBytes: number) =>
  Duration.millis(
    REQUEST_BASE_TIMEOUT_MS +
      Math.ceil((bodyBytes / SLOWEST_UPLOAD_BYTES_PER_SECOND) * 1000)
  );

const bodyByteLength = (body: RequestInit["body"]) => {
  if (body instanceof Uint8Array) return body.byteLength;
  if (typeof body === "string") return Buffer.byteLength(body);
  return 0;
};

/** undici hides the socket's error code behind `fetch failed`; surface it. */
const describeNetworkError = (error: unknown) => {
  if (!(error instanceof Error)) return String(error);
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string"
    ? `${error.message} (${code})`
    : error.message;
};

const DROPBOX_API_HOST = "https://api.dropboxapi.com";
const DROPBOX_CONTENT_HOST = "https://content.dropboxapi.com";

const baseUrl = (name: string, fallback: string) =>
  Config.string(name).pipe(
    Config.withDefault(fallback),
    Config.map((url) => url.replace(/\/+$/, ""))
  );

/**
 * Where Dropbox's two hosts live: the RPC API (and its OAuth token endpoint)
 * and the content API that moves bytes. Overridable (`DROPBOX_API_URL`,
 * `DROPBOX_CONTENT_URL`) so a verification run points every Dropbox call at
 * a local stub; nothing sets them day to day. verify-cvm defaults both to a
 * dead port.
 */
export const dropboxApiUrl = baseUrl("DROPBOX_API_URL", DROPBOX_API_HOST);
export const dropboxContentUrl = baseUrl(
  "DROPBOX_CONTENT_URL",
  DROPBOX_CONTENT_HOST
);

/** `url` on whichever host the configuration names for it. */
export const resolveDropboxUrl = (url: string) =>
  Effect.gen(function* () {
    if (url.startsWith(DROPBOX_CONTENT_HOST)) {
      return (
        (yield* dropboxContentUrl) + url.slice(DROPBOX_CONTENT_HOST.length)
      );
    }
    if (url.startsWith(DROPBOX_API_HOST)) {
      return (yield* dropboxApiUrl) + url.slice(DROPBOX_API_HOST.length);
    }
    return url;
  });

/**
 * One try: the request and its whole response body, under one deadline. The
 * body is read here, not by the caller, so a connection that dies after the
 * headers is caught by the same timeout and retry. Dropbox's answers are
 * small JSON or a `course.json` receipt, so holding one in memory is cheap.
 */
const attemptOnce = (target: string, init: RequestInit, endpoint: string) => {
  const timeout = requestTimeout(bodyByteLength(init.body));
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(target, { ...init, signal });
      const body = await response.arrayBuffer();
      return { response, body };
    },
    catch: (cause) =>
      new DropboxApiError({
        message: `${endpoint}: network error: ${describeNetworkError(cause)}`,
        endpoint,
        network: "connection",
        cause,
      }),
  }).pipe(
    Effect.timeoutFail({
      duration: timeout,
      onTimeout: () =>
        new DropboxApiError({
          message: `${endpoint}: no response within ${Duration.format(timeout)}`,
          endpoint,
          network: "timeout",
        }),
    })
  );
};

const failForStatus = (
  response: Response,
  body: ArrayBuffer,
  endpoint: string
) => {
  if (isTransientStatus(response.status)) {
    const retryAfter = parseInt(response.headers.get("Retry-After") ?? "0", 10);
    const fail = Effect.fail(
      new DropboxApiError({
        message: `Transient error: ${response.status}`,
        status: response.status,
        endpoint,
      })
    );
    return retryAfter > 0
      ? Effect.sleep(Duration.seconds(retryAfter)).pipe(Effect.zipRight(fail))
      : fail;
  }
  return Effect.fail(
    new DropboxApiError({
      message: `HTTP ${response.status}: ${new TextDecoder().decode(body)}`,
      status: response.status,
      endpoint,
    })
  );
};

/**
 * Every Dropbox request goes through here. A 429, a 5xx, a dropped
 * connection or a request that outlives its `requestTimeout` is retried with
 * exponential backoff, up to five times; each failed try is logged, so a
 * Publish's job log shows a flaky network as it happens. The `Response` handed
 * back already holds its whole body.
 */
export const dropboxFetch = Effect.fn("dropboxFetch")(function* (
  url: string,
  init: RequestInit,
  endpoint: string
) {
  const target = yield* resolveDropboxUrl(url).pipe(
    Effect.mapError(
      (e) => new DropboxApiError({ message: String(e), endpoint })
    )
  );
  let attempt = 0;
  return yield* Effect.suspend(() => {
    attempt += 1;
    return attemptOnce(target, init, endpoint);
  }).pipe(
    Effect.flatMap(({ response, body }) =>
      response.ok
        ? Effect.succeed(
            new Response(body.byteLength > 0 ? body : null, {
              status: response.status,
              headers: response.headers,
            })
          )
        : failForStatus(response, body, endpoint)
    ),
    Effect.tapError((error) =>
      isRetryable(error)
        ? Effect.logWarning(
            `dropbox: ${endpoint} attempt ${attempt} of ${MAX_RETRIES + 1} failed: ${error.message}`
          )
        : Effect.void
    ),
    Effect.retry({ while: isRetryable, schedule: retrySchedule })
  );
});
