import { vi } from "vitest";
import { computeDropboxContentHash } from "@/services/dropbox-content-hash";

type StoredFile = {
  content: Buffer;
  contentHash: string;
  pathDisplay: string;
};

export const FAKE_ACCESS_TOKEN = "fake-dropbox-access-token";

/** A request's lifetime on a logical clock, so overlap is computable. */
type RequestSpan = {
  url: string;
  init: RequestInit;
  start: number;
  end: number;
};

type RequestMatcher = (url: string, init: RequestInit) => boolean;

type InjectedFailure = {
  match: RequestMatcher;
  remaining: number;
  status: number;
  retryAfterSeconds?: number;
};

export const createFakeDropbox = () => {
  const files = new Map<string, StoredFile>();
  const sessions = new Map<string, { chunks: Buffer[] }>();
  const copyJobs = new Map<string, unknown[]>();
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  let sessionCounter = 0;

  // ── In-flight instrumentation ──────────────────────────────────────
  // Requests are timestamped on a logical clock (incremented per event)
  // rather than a wall clock, so peak-concurrency assertions never depend
  // on timing.
  const requestSpans: RequestSpan[] = [];
  let logicalClock = 0;

  /**
   * The largest number of matching requests that were ever simultaneously
   * in flight.
   */
  const peakConcurrentRequests = (match: RequestMatcher = () => true) => {
    const events: Array<{ at: number; delta: number }> = [];
    for (const span of requestSpans) {
      if (!match(span.url, span.init)) continue;
      events.push({ at: span.start, delta: 1 });
      events.push({ at: span.end, delta: -1 });
    }
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let current = 0;
    let peak = 0;
    for (const event of events) {
      current += event.delta;
      peak = Math.max(peak, current);
    }
    return peak;
  };

  // ── Deterministic concurrency barrier ──────────────────────────────
  let barrier: {
    count: number;
    match: RequestMatcher;
    waiting: Array<() => void>;
  } | null = null;

  const releaseBarrier = () => {
    const pending = barrier;
    barrier = null;
    for (const resolve of pending?.waiting ?? []) resolve();
  };

  /**
   * Hold every matching request open until `count` of them are in flight at
   * once, then release them all and stop holding. No timers are involved, so
   * a caller that uploads serially never trips the barrier and the test hangs
   * to its timeout rather than passing by accident.
   */
  const holdUntilInFlight = (
    count: number,
    match: RequestMatcher = () => true
  ) => {
    barrier = { count, match, waiting: [] };
    return releaseBarrier;
  };

  // ── Arrival watchers ───────────────────────────────────────────────
  const requestWatchers: Array<{
    match: RequestMatcher;
    resolve: () => void;
  }> = [];

  /**
   * Resolves the moment a matching request ARRIVES — before any barrier,
   * injected failure or dispatch. Event-driven, so a test can wait on "this
   * Video started uploading" without polling or sleeping.
   */
  const waitForRequest = (match: RequestMatcher = () => true) =>
    new Promise<void>((resolve) => {
      requestWatchers.push({ match, resolve });
    });

  const notifyWatchers = (url: string, init: RequestInit) => {
    for (let index = requestWatchers.length - 1; index >= 0; index--) {
      if (!requestWatchers[index]!.match(url, init)) continue;
      requestWatchers.splice(index, 1)[0]!.resolve();
    }
  };

  // ── Fault injection ────────────────────────────────────────────────
  const injectedFailures: InjectedFailure[] = [];

  /** Answer the next `times` matching requests with `status`. */
  const failNextRequests = (opts: {
    match: RequestMatcher;
    times: number;
    status: number;
    retryAfterSeconds?: number;
  }) => {
    injectedFailures.push({
      match: opts.match,
      remaining: opts.times,
      status: opts.status,
      retryAfterSeconds: opts.retryAfterSeconds,
    });
  };

  const takeInjectedFailure = (url: string, init: RequestInit) => {
    const failure = injectedFailures.find(
      (candidate) => candidate.remaining > 0 && candidate.match(url, init)
    );
    if (!failure) return null;
    failure.remaining -= 1;
    return failure;
  };

  const store = (pathDisplay: string, content: Buffer) => {
    const key = pathDisplay.toLowerCase();
    files.set(key, {
      content,
      contentHash: computeDropboxContentHash(content),
      pathDisplay,
    });
  };

  const get = (path: string): StoredFile | undefined =>
    files.get(path.toLowerCase());

  const fileMetadata = (stored: StoredFile) => ({
    ".tag": "file" as const,
    name: stored.pathDisplay.split("/").pop()!,
    path_display: stored.pathDisplay,
    size: stored.content.length,
    content_hash: stored.contentHash,
  });

  const bodyToBuffer = async (
    body: BodyInit | null | undefined
  ): Promise<Buffer> => {
    if (body == null) return Buffer.alloc(0);
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(body);
    if (typeof body === "string") return Buffer.from(body);
    return Buffer.from(await new Response(body).arrayBuffer());
  };

  const getApiArg = (headers: HeadersInit | undefined): any => {
    const raw = (headers as Record<string, string> | undefined)?.[
      "Dropbox-API-Arg"
    ];
    return raw ? JSON.parse(raw) : {};
  };

  const dispatch = async (
    urlStr: string,
    reqInit: RequestInit
  ): Promise<Response> => {
    // Upload
    if (urlStr.includes("/2/files/upload") && !urlStr.includes("session")) {
      const apiArg = getApiArg(reqInit.headers);
      const content = await bodyToBuffer(reqInit.body);
      store(apiArg.path, content);
      return new Response(JSON.stringify(fileMetadata(get(apiArg.path)!)));
    }

    // Upload session start
    if (urlStr.includes("/2/files/upload_session/start")) {
      const id = `session-${++sessionCounter}`;
      const content = await bodyToBuffer(reqInit.body);
      sessions.set(id, { chunks: [content] });
      return new Response(JSON.stringify({ session_id: id }));
    }

    // Upload session append
    if (urlStr.includes("/2/files/upload_session/append_v2")) {
      const apiArg = getApiArg(reqInit.headers);
      const session = sessions.get(apiArg.cursor.session_id);
      if (!session) {
        return new Response(JSON.stringify({ error: "session not found" }), {
          status: 409,
        });
      }
      const content = await bodyToBuffer(reqInit.body);
      session.chunks.push(content);
      return new Response(null, { status: 200 });
    }

    // Upload session finish
    if (urlStr.includes("/2/files/upload_session/finish")) {
      const apiArg = getApiArg(reqInit.headers);
      const session = sessions.get(apiArg.cursor.session_id);
      if (!session) {
        return new Response(JSON.stringify({ error: "session not found" }), {
          status: 409,
        });
      }
      const lastChunk = await bodyToBuffer(reqInit.body);
      if (lastChunk.length > 0) session.chunks.push(lastChunk);
      const fullContent = Buffer.concat(session.chunks);
      sessions.delete(apiArg.cursor.session_id);
      store(apiArg.commit.path, fullContent);
      return new Response(
        JSON.stringify(fileMetadata(get(apiArg.commit.path)!))
      );
    }

    // Copy batch — always answered asynchronously, exactly as the real route
    // behaves even for a single entry. The copy itself happens server-side
    // here too: no request body ever carries the bytes.
    if (urlStr.includes("/2/files/copy_batch_v2")) {
      const body = JSON.parse(reqInit.body as string);
      const entries = (body.entries as Array<any>).map((entry) => {
        const source = get(entry.from_path);
        if (!source) {
          return {
            ".tag": "failure",
            failure: { ".tag": "relocation_error", reason: "not_found" },
          };
        }
        store(entry.to_path, source.content);
        return {
          ".tag": "success",
          success: fileMetadata(get(entry.to_path)!),
        };
      });
      const jobId = `copy-job-${++sessionCounter}`;
      copyJobs.set(jobId, entries);
      return new Response(
        JSON.stringify({ ".tag": "async_job_id", async_job_id: jobId })
      );
    }

    if (urlStr.includes("/2/files/copy_batch/check_v2")) {
      const body = JSON.parse(reqInit.body as string);
      return new Response(
        JSON.stringify({
          ".tag": "complete",
          entries: copyJobs.get(body.async_job_id) ?? [],
        })
      );
    }

    // Download
    if (urlStr.includes("/2/files/download")) {
      const apiArg = getApiArg(reqInit.headers);
      const stored = get(apiArg.path);
      if (!stored) {
        return new Response(
          JSON.stringify({
            error_summary: "path/not_found/..",
            error: { ".tag": "path", path: { ".tag": "not_found" } },
          }),
          { status: 409 }
        );
      }
      return new Response(new Uint8Array(stored.content), {
        headers: {
          "Dropbox-API-Result": JSON.stringify(fileMetadata(stored)),
        },
      });
    }

    // Get metadata
    if (urlStr.includes("/2/files/get_metadata")) {
      const body = JSON.parse(reqInit.body as string);
      const stored = get(body.path);
      if (!stored) {
        // Check if it's a folder
        const prefix = body.path.toLowerCase() + "/";
        const isFolder = Array.from(files.keys()).some((k) =>
          k.startsWith(prefix)
        );
        if (isFolder) {
          return new Response(
            JSON.stringify({
              ".tag": "folder",
              name: body.path.split("/").pop(),
              path_display: body.path,
            })
          );
        }
        return new Response(
          JSON.stringify({
            error_summary: "path/not_found/..",
            error: { ".tag": "path", path: { ".tag": "not_found" } },
          }),
          { status: 409 }
        );
      }
      return new Response(JSON.stringify(fileMetadata(stored)));
    }

    // List folder
    if (
      urlStr.includes("/2/files/list_folder") &&
      !urlStr.includes("continue")
    ) {
      const body = JSON.parse(reqInit.body as string);
      const prefix = body.path.toLowerCase();
      const entries: any[] = [];
      const seenFolders = new Set<string>();

      for (const [key, stored] of files) {
        if (!key.startsWith(prefix + "/")) continue;
        entries.push(fileMetadata(stored));
        // Add parent folder entries if recursive
        if (body.recursive) {
          const rel = stored.pathDisplay.slice(body.path.length + 1);
          const parts = rel.split("/");
          for (let i = 1; i < parts.length; i++) {
            const folderPath = body.path + "/" + parts.slice(0, i).join("/");
            if (!seenFolders.has(folderPath.toLowerCase())) {
              seenFolders.add(folderPath.toLowerCase());
              entries.push({
                ".tag": "folder",
                name: parts[i - 1],
                path_display: folderPath,
              });
            }
          }
        }
      }

      return new Response(
        JSON.stringify({ entries, has_more: false, cursor: "fake-cursor" })
      );
    }

    // Fallback
    return new Response(JSON.stringify({ error: "unhandled" }), {
      status: 500,
    });
  };

  const handleFetch = async (
    url: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const urlStr =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;
    const reqInit = init ?? {};
    fetchCalls.push({ url: urlStr, init: reqInit });

    const span: RequestSpan = {
      url: urlStr,
      init: reqInit,
      start: ++logicalClock,
      end: Number.POSITIVE_INFINITY,
    };
    requestSpans.push(span);
    notifyWatchers(urlStr, reqInit);

    try {
      if (barrier?.match(urlStr, reqInit)) {
        const held = barrier;
        const wait = new Promise<void>((resolve) => held.waiting.push(resolve));
        if (held.waiting.length >= held.count) releaseBarrier();
        await wait;
      }

      const failure = takeInjectedFailure(urlStr, reqInit);
      if (failure) {
        return new Response(JSON.stringify({ error_summary: "injected" }), {
          status: failure.status,
          headers: failure.retryAfterSeconds
            ? { "Retry-After": String(failure.retryAfterSeconds) }
            : undefined,
        });
      }

      return await dispatch(urlStr, reqInit);
    } finally {
      span.end = ++logicalClock;
    }
  };

  const install = () => {
    vi.stubGlobal("fetch", vi.fn(handleFetch));
  };

  const cleanup = () => {
    releaseBarrier();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  };

  return {
    files,
    fetchCalls,
    get,
    store,
    install,
    cleanup,
    handleFetch,
    peakConcurrentRequests,
    holdUntilInFlight,
    waitForRequest,
    failNextRequests,
  };
};
