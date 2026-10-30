import { Data, Effect } from "effect";
import { getValidAccessToken } from "@/services/youtube-auth-service";
import { youtubeApiUrl } from "@/services/youtube-upload-service";
import type { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import type {
  Broadcast,
  BroadcastListAnswer,
  ReconnectReason,
} from "@/features/streaming/broadcast";
import type {
  ChatMessage,
  ChatOverReason,
} from "@/features/streaming/broadcast-chat";

/**
 * The YouTube Live service: what CVM asks YouTube about **Broadcasts**. It
 * reads with the stored Google grant (`getValidAccessToken`) and honours the
 * YouTube API URL override, so a test fakes YouTube at the HTTP boundary.
 * CVM never calls the Broadcast transition API and never creates a
 * Broadcast: YouTube's auto-start and auto-stop drive it.
 *
 * It also reads a Broadcast's live chat, a page at a time
 * (`openChatStream`, `listChatPage`); the app server's chat
 * (`broadcast-chat.ts`) decides when.
 */

export class YouTubeLiveError extends Data.TaggedError("YouTubeLiveError")<{
  message: string;
}> {}

/** The stored grant was given before CVM asked for `youtube.force-ssl`. */
class LiveAccessMissing extends Data.TaggedError("LiveAccessMissing")<{}> {}

/** Google's 403 for a token granted without the scope the call needs. */
const isInsufficientScope = (status: number, body: unknown): boolean => {
  if (status !== 403) return false;
  const error = (body as { error?: GoogleError } | null)?.error;
  return (
    (error?.errors ?? []).some((e) => e.reason === "insufficientPermissions") ||
    (error?.details ?? []).some(
      (d) => d.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT"
    )
  );
};

type GoogleError = {
  message?: string;
  errors?: { reason?: string }[];
  details?: { reason?: string }[];
};

type LiveBroadcastItem = {
  id: string;
  snippet?: {
    title?: string;
    scheduledStartTime?: string;
    liveChatId?: string;
  };
  contentDetails?: {
    enableAutoStart?: boolean;
    enableAutoStop?: boolean;
    boundStreamId?: string;
  };
};

const toBroadcast = (item: LiveBroadcastItem): Broadcast => ({
  id: item.id,
  title: item.snippet?.title ?? "",
  scheduledStartTime: item.snippet?.scheduledStartTime ?? null,
  enableAutoStart: item.contentDetails?.enableAutoStart ?? false,
  enableAutoStop: item.contentDetails?.enableAutoStop ?? false,
  liveChatId: item.snippet?.liveChatId ?? null,
  boundStreamId: item.contentDetails?.boundStreamId ?? null,
});

/** One page (50) of the channel's Broadcasts in one `broadcastStatus`. */
const fetchBroadcasts = (opts: {
  apiUrl: string;
  accessToken: string;
  broadcastStatus: "active" | "upcoming";
}) =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(
        `${opts.apiUrl}/youtube/v3/liveBroadcasts?part=snippet,contentDetails&broadcastStatus=${opts.broadcastStatus}&broadcastType=all&maxResults=50`,
        { headers: { Authorization: `Bearer ${opts.accessToken}` }, signal }
      );
      const body = (await response.json().catch(() => null)) as {
        items?: LiveBroadcastItem[];
        error?: GoogleError;
      } | null;
      if (isInsufficientScope(response.status, body)) {
        return { accessMissing: true as const };
      }
      if (!response.ok) {
        throw new Error(
          `YouTube answered ${response.status} listing ${opts.broadcastStatus} Broadcasts: ${body?.error?.message ?? "no message"}`
        );
      }
      return { items: (body?.items ?? []).map(toBroadcast) };
    },
    catch: (e) =>
      new YouTubeLiveError({
        message: e instanceof Error ? e.message : String(e),
      }),
  }).pipe(
    Effect.flatMap((result) =>
      "accessMissing" in result
        ? Effect.fail(new LiveAccessMissing())
        : Effect.succeed(result.items)
    )
  );

const byScheduledStart = (a: Broadcast, b: Broadcast) =>
  (a.scheduledStartTime ?? "").localeCompare(b.scheduledStartTime ?? "");

/**
 * The channel's active and upcoming Broadcasts (active first, then by
 * scheduled start), or why Google needs reconnecting first: no stored grant,
 * or one given before CVM asked for live-streaming access.
 */
export const listBroadcasts = Effect.gen(function* () {
  const accessToken = yield* getValidAccessToken;
  const apiUrl = yield* youtubeApiUrl;
  const [active, upcoming] = yield* Effect.all(
    [
      fetchBroadcasts({ apiUrl, accessToken, broadcastStatus: "active" }),
      fetchBroadcasts({ apiUrl, accessToken, broadcastStatus: "upcoming" }),
    ],
    { concurrency: "unbounded" }
  );
  const answer: BroadcastListAnswer = {
    status: "listed",
    broadcasts: [
      ...[...active].sort(byScheduledStart),
      ...[...upcoming].sort(byScheduledStart),
    ],
  };
  return answer;
}).pipe(
  Effect.catchTags({
    NotAuthenticatedError: () =>
      Effect.succeed<BroadcastListAnswer>({
        status: "needs-reconnect",
        reason: "not-connected",
      }),
    LiveAccessMissing: () =>
      Effect.succeed<BroadcastListAnswer>({
        status: "needs-reconnect",
        reason: "missing-live-access",
      }),
    YouTubeAuthError: (e) =>
      Effect.fail(new YouTubeLiveError({ message: e.message })),
  })
);

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** One page of chat: a `liveChatMessageListResponse`, as CVM reads it. */
export type ChatPage = {
  messages: ChatMessage[];
  nextPageToken: string | null;
  /** How long YouTube asks a poller to wait before the next `list`. */
  pollingIntervalMillis: number | null;
};

/** Why YouTube didn't give chat, by what CVM does next. */
export type ChatRefusal =
  /** The stream connection was refused: poll `list` instead. */
  | { status: "refused"; message: string }
  /** Worth asking again after a pause (a 5xx, a rate limit). */
  | { status: "dropped"; message: string }
  /** No more chat for this Broadcast will come. */
  | { status: "over"; reason: ChatOverReason }
  | { status: "needs-reconnect"; reason: ReconnectReason };

export type ChatStreamAnswer =
  { status: "open"; pages: AsyncIterable<ChatPage> } | ChatRefusal;

export type ChatListAnswer = { status: "page"; page: ChatPage } | ChatRefusal;

type LiveChatMessageItem = {
  id?: string;
  snippet?: { displayMessage?: string; publishedAt?: string };
  authorDetails?: { displayName?: string };
};

type LiveChatMessageList = {
  items?: LiveChatMessageItem[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
};

const toChatPage = (body: LiveChatMessageList): ChatPage => ({
  messages: (body.items ?? []).flatMap((item) =>
    item.id && item.snippet?.displayMessage
      ? [
          {
            id: item.id,
            author: item.authorDetails?.displayName ?? "",
            text: item.snippet.displayMessage,
            publishedAt: item.snippet.publishedAt ?? "",
          },
        ]
      : []
  ),
  nextPageToken: body.nextPageToken ?? null,
  pollingIntervalMillis: body.pollingIntervalMillis ?? null,
});

const CHAT_OVER_REASONS: Record<string, ChatOverReason> = {
  liveChatEnded: "ended",
  liveChatNotFound: "not-found",
  liveChatDisabled: "disabled",
};

/** What YouTube's error answer to a chat call means for CVM. */
const chatRefusal = (status: number, body: unknown): ChatRefusal => {
  if (isInsufficientScope(status, body)) {
    return { status: "needs-reconnect", reason: "missing-live-access" };
  }
  const error = (body as { error?: GoogleError } | null)?.error;
  const reasons = (error?.errors ?? []).map((e) => e.reason ?? "");
  const over = reasons.map((r) => CHAT_OVER_REASONS[r]).find(Boolean);
  if (over) return { status: "over", reason: over };
  const message = `YouTube answered ${status}: ${error?.message ?? "no message"}`;
  if (
    status >= 500 ||
    status === 429 ||
    reasons.includes("rateLimitExceeded")
  ) {
    return { status: "dropped", message };
  }
  return { status: "refused", message };
};

/**
 * Each top-level JSON object in a server-streamed REST answer, as it
 * arrives. YouTube frames one as a JSON array sent an element at a time
 * (`[{…}\r\n,{…}…]`); the array's brackets and commas are skipped.
 */
async function* jsonObjects(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let pending = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for await (const chunk of body) {
    const text = decoder.decode(chunk, { stream: true });
    for (const char of text) {
      if (depth > 0) pending += char;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"' && depth > 0) inString = true;
      else if (char === "{") {
        if (depth === 0) pending = char;
        depth++;
      } else if (char === "}" && depth > 0) {
        depth--;
        if (depth === 0) yield JSON.parse(pending) as unknown;
      }
    }
  }
}

/**
 * One authorised chat call to YouTube, with its JSON body read unless it is
 * an open stream (whose pages the caller reads as they come).
 */
const chatFetch = (opts: {
  path: "liveChat/messages/stream" | "liveChat/messages";
  liveChatId: string;
  pageToken: string | null;
  signal: AbortSignal;
}) =>
  Effect.gen(function* () {
    const accessToken = yield* getValidAccessToken;
    const apiUrl = yield* youtubeApiUrl;
    const query = new URLSearchParams({
      liveChatId: opts.liveChatId,
      part: "snippet,authorDetails",
    });
    if (opts.pageToken !== null) query.set("pageToken", opts.pageToken);
    return yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(
          `${apiUrl}/youtube/v3/${opts.path}?${query}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: opts.signal,
          }
        );
        const streaming =
          opts.path === "liveChat/messages/stream" && response.ok;
        const body: unknown = streaming
          ? null
          : await response.json().catch(() => null);
        return { response, body };
      },
      catch: (e) =>
        new YouTubeLiveError({
          message: e instanceof Error ? e.message : String(e),
        }),
    });
  });

const needsConnecting = {
  NotAuthenticatedError: () =>
    Effect.succeed({
      status: "needs-reconnect" as const,
      reason: "not-connected" as const,
    }),
  YouTubeAuthError: (e: { message: string }) =>
    Effect.fail(new YouTubeLiveError({ message: e.message })),
};

/**
 * Opens a `liveChatMessages.streamList` connection: one call (5 quota
 * units) that YouTube keeps open, sending each new page of chat on it.
 * `pageToken` resumes after the last page heard. Aborting `signal` closes
 * it. A network failure fails with `YouTubeLiveError`, as does a stream
 * that breaks while its pages are read.
 */
export const openChatStream = (opts: {
  liveChatId: string;
  pageToken: string | null;
  signal: AbortSignal;
}) =>
  Effect.gen(function* () {
    const { response, body: error } = yield* chatFetch({
      ...opts,
      path: "liveChat/messages/stream",
    });
    if (!response.ok || response.body === null) {
      return chatRefusal(response.status, error);
    }
    const body = response.body;
    const pages = (async function* () {
      for await (const object of jsonObjects(body)) {
        yield toChatPage(object as LiveChatMessageList);
      }
    })();
    return { status: "open", pages } satisfies ChatStreamAnswer;
  }).pipe(Effect.catchTags(needsConnecting));

/** One `liveChatMessages.list` poll: only once the stream was refused. */
export const listChatPage = (opts: {
  liveChatId: string;
  pageToken: string | null;
  signal: AbortSignal;
}) =>
  Effect.gen(function* () {
    const { response, body } = yield* chatFetch({
      ...opts,
      path: "liveChat/messages",
    });
    if (!response.ok) return chatRefusal(response.status, body);
    return {
      status: "page",
      page: toChatPage((body ?? {}) as LiveChatMessageList),
    } satisfies ChatListAnswer;
  }).pipe(Effect.catchTags(needsConnecting));

/** What the app server's chat asks YouTube, run by the caller's runtime. */
export type ChatYouTube = {
  openStream: (opts: {
    liveChatId: string;
    pageToken: string | null;
    signal: AbortSignal;
  }) => Promise<ChatStreamAnswer>;
  listPage: (opts: {
    liveChatId: string;
    pageToken: string | null;
    signal: AbortSignal;
  }) => Promise<ChatListAnswer>;
};

export const chatYouTube = (
  run: <A, E>(
    effect: Effect.Effect<A, E, LinkAuthOperationsService>
  ) => Promise<A>
): ChatYouTube => ({
  openStream: (opts) => run(openChatStream(opts)),
  listPage: (opts) => run(listChatPage(opts)),
});
