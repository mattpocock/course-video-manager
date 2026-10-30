import { Data, Effect } from "effect";
import { getValidAccessToken } from "@/services/youtube-auth-service";
import { youtubeApiUrl } from "@/services/youtube-upload-service";
import type {
  Broadcast,
  BroadcastListAnswer,
} from "@/features/streaming/broadcast";

/**
 * The YouTube Live service: what CVM asks YouTube about **Broadcasts**. It
 * reads with the stored Google grant (`getValidAccessToken`) and honours the
 * YouTube API URL override, so a test fakes YouTube at the HTTP boundary.
 * CVM never calls the Broadcast transition API and never creates a
 * Broadcast: YouTube's auto-start and auto-stop drive it.
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
