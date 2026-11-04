import { Effect } from "effect";
import type {
  Broadcast,
  MonetizationResult,
  NewBroadcastSettings,
  ReconnectReason,
  ThumbnailResult,
} from "@/features/streaming/broadcast";
import { getValidAccessToken } from "@/services/youtube-auth-service";
import { setYouTubeThumbnail } from "@/services/youtube-upload-service";
import {
  liveApiCall,
  needsConnecting,
  toBroadcast,
  YouTubeLiveError,
  type LiveBroadcastItem,
} from "@/services/youtube-live-service";

/**
 * The YouTube Live service's writes to a **Broadcast** beyond binding and
 * completing it: creating one for **New Broadcast** and turning its ads
 * monetization off through the service's `liveApiCall`, and setting its
 * thumbnail through the YouTube upload's `setYouTubeThumbnail`. A test fakes
 * YouTube at the HTTP boundary.
 */

/** YouTube wants a new Broadcast's start in the future: this long after submit. */
const NEW_BROADCAST_START_DELAY_MS = 5 * 60 * 1000;

/** What inserting a new Broadcast answered. */
export type CreateBroadcastAnswer =
  | { status: "created"; broadcast: Broadcast }
  | { status: "needs-reconnect"; reason: ReconnectReason };

/**
 * Creates a **Broadcast** (`liveBroadcasts.insert`): not made for kids,
 * auto-start and auto-stop on, as CVM never starts one itself and Go Live
 * refuses one without either. It answers the Broadcast as YouTube does.
 */
export const createBroadcast = (
  settings: NewBroadcastSettings,
  submittedAt: Date
) =>
  liveApiCall({
    method: "POST",
    path: "liveBroadcasts",
    query: { part: "snippet,contentDetails,status" },
    body: {
      snippet: {
        title: settings.title,
        description: settings.description,
        scheduledStartTime: new Date(
          submittedAt.getTime() + NEW_BROADCAST_START_DELAY_MS
        ).toISOString(),
      },
      status: {
        privacyStatus: settings.privacyStatus,
        selfDeclaredMadeForKids: false,
      },
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: true,
        latencyPreference: settings.latencyPreference,
      },
    },
    what: "creating the Broadcast",
  }).pipe(
    Effect.map((body): CreateBroadcastAnswer => ({
      status: "created",
      broadcast: toBroadcast(body as LiveBroadcastItem),
    })),
    Effect.catchTags({
      ...needsConnecting,
      LiveAccessMissing: () =>
        Effect.succeed<CreateBroadcastAnswer>({
          status: "needs-reconnect",
          reason: "missing-live-access",
        }),
    })
  );

/** Any failure to reach YouTube, a missing grant included, as a `YouTubeLiveError`. */
const asLiveError = {
  NotAuthenticatedError: () =>
    Effect.fail(new YouTubeLiveError({ message: "Google is not connected." })),
  LiveAccessMissing: () =>
    Effect.fail(
      new YouTubeLiveError({
        message: "the Google grant has no live-streaming access.",
      })
    ),
  YouTubeAuthError: (e: { message: string }) =>
    Effect.fail(new YouTubeLiveError({ message: e.message })),
};

/**
 * Turns the Broadcast's ads monetization off (`liveBroadcasts.update`, only
 * the `monetizationDetails` part, so nothing else on it is overwritten).
 * Insert can't set it. Any failure, a missing grant included, is answered,
 * never failed: the Broadcast exists either way.
 */
export const turnMonetizationOff = (broadcastId: string) =>
  liveApiCall({
    method: "PUT",
    path: "liveBroadcasts",
    query: { part: "monetizationDetails" },
    body: {
      id: broadcastId,
      monetizationDetails: { adsMonetizationStatus: "off" },
    },
    what: "turning the Broadcast's monetization off",
  }).pipe(
    Effect.map((): MonetizationResult => ({ status: "off" })),
    Effect.catchTags(asLiveError),
    Effect.catchTag("YouTubeLiveError", (e) =>
      Effect.succeed<MonetizationResult>(
        e.reasons?.includes("monetizationDetailsModificationNotAllowed")
          ? { status: "not-eligible" }
          : { status: "failed", message: e.message }
      )
    )
  );

/**
 * Sets the Broadcast's thumbnail (`thumbnails.set`, 50 units) to the image
 * at `thumbnailFilePath`: a Broadcast's id is its video's id. Any failure is
 * answered with its reason, never failed: the Broadcast is there either way.
 */
export const setBroadcastThumbnail = (
  broadcastId: string,
  thumbnailFilePath: string
) =>
  Effect.gen(function* () {
    const accessToken = yield* getValidAccessToken;
    yield* setYouTubeThumbnail({
      accessToken,
      youtubeVideoId: broadcastId,
      thumbnailFilePath,
    });
    return { status: "set" } as ThumbnailResult;
  }).pipe(
    Effect.catchTags({
      YouTubeUploadError: (e) =>
        Effect.succeed<ThumbnailResult>({
          status: "failed",
          reason: e.message,
        }),
      NotAuthenticatedError: () =>
        Effect.succeed<ThumbnailResult>({
          status: "failed",
          reason: "Google is not connected.",
        }),
      YouTubeAuthError: (e) =>
        Effect.succeed<ThumbnailResult>({
          status: "failed",
          reason: e.message,
        }),
    })
  );

type VideoStatusBody = {
  items?: { status?: Record<string, unknown> }[];
} | null;

/**
 * The writable `status` fields `videos.update` resets when not sent, as read
 * back. `selfDeclaredMadeForKids` and `containsSyntheticMedia` only change
 * when sent, so they are left out; the rest (`uploadStatus`, `madeForKids`…)
 * are read-only.
 */
const RESET_WHEN_UNSENT = [
  "embeddable",
  "license",
  "publicStatsViewable",
  "publishAt",
] as const;

/**
 * **Unlist When Ended**: makes the Broadcast's video Unlisted
 * (`videos.list part=status`, then `videos.update part=status`: 51 quota
 * units). The update resets the writable `status` fields it isn't sent, so
 * those read back are sent again, with `privacyStatus` unlisted. Any failure
 * is a `YouTubeLiveError`.
 */
export const unlistBroadcast = (broadcastId: string) =>
  Effect.gen(function* () {
    const read = (yield* liveApiCall({
      method: "GET",
      path: "videos",
      query: { part: "status", id: broadcastId },
      what: "reading the Broadcast's privacy",
    })) as VideoStatusBody;
    const status = read?.items?.[0]?.status;
    if (!status)
      return yield* new YouTubeLiveError({
        message: "YouTube has no video for the Broadcast",
      });
    yield* liveApiCall({
      method: "PUT",
      path: "videos",
      query: { part: "status" },
      body: {
        id: broadcastId,
        status: {
          privacyStatus: "unlisted",
          ...Object.fromEntries(
            RESET_WHEN_UNSENT.filter((f) => status[f] !== undefined).map(
              (f) => [f, status[f]]
            )
          ),
        },
      },
      what: "making the Broadcast Unlisted",
    });
  }).pipe(Effect.catchTags(asLiveError));
