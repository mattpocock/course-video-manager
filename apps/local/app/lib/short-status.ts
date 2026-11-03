import {
  CircleAlert,
  Circle,
  Download,
  ListOrdered,
  Send,
  type LucideIcon,
} from "lucide-react";
import type { VideoPostPlatform } from "@/services/db-video-post-operations.server";

export type ShortStatus =
  "recorded" | "exported" | "queued" | "posted" | "failed";

/**
 * Where a Short stands in the Posting Queue, as the grid shows it: Queued
 * while it has a live entry (Queued, Posting or Held), Failed when its latest
 * entry the queue still shows Failed.
 */
export type ShortQueueState = "queued" | "failed";

export type PostedPlatforms = { youtube: boolean; tiktok: boolean };

// The one place a Video Post's platform becomes a PostedPlatforms flag. The
// Shorts grid tile and the posting modal's indicator both read a Short's
// posted status through `getPostedPlatforms`, so they cannot drift apart.
//
// The annotation is load-bearing: this Record is total over
// `VideoPostPlatform`, so adding a platform is a compile error here rather
// than a Short that silently reads "posted" in one place and not the other.
const PLATFORM_FLAG: Record<VideoPostPlatform, keyof PostedPlatforms> = {
  "youtube-shorts": "youtube",
  buffer: "tiktok",
};

// The `platform` column is a plain `text`, so a row's platform is a `string`.
// Widening the lookup for indexing keeps the literal above total.
const platformFlags: Record<string, keyof PostedPlatforms | undefined> =
  PLATFORM_FLAG;

/**
 * Which platforms a Video has been posted to. A Video Post with no `postedAt`
 * is queued, not posted, and does not count.
 */
export function getPostedPlatforms(
  posts: ReadonlyArray<{ platform: string; postedAt: Date | null }>
): PostedPlatforms {
  const posted: PostedPlatforms = { youtube: false, tiktok: false };
  for (const post of posts) {
    if (post.postedAt === null) continue;
    const flag = platformFlags[post.platform];
    if (flag) posted[flag] = true;
  }
  return posted;
}

/**
 * Each Short's Posting Queue state, from the entries the Queue panel shows
 * (`cvm short queue`'s listing). A live entry wins over a Failed one, so a
 * Short queued again after failing reads Queued.
 */
export function getShortQueueStates(
  entries: ReadonlyArray<{ videoId: string; state: string }>
): Record<string, ShortQueueState> {
  const states: Record<string, ShortQueueState> = {};
  for (const entry of entries) {
    if (entry.state === "failed") states[entry.videoId] ??= "failed";
    else states[entry.videoId] = "queued";
  }
  return states;
}

/**
 * A Short's status on the Shorts grid: Recorded, Exported, Queued, Posted,
 * in the order a Short goes through them, or Failed. The Posting Queue
 * outranks the Video Posts: a Short posted on one channel and queued for the
 * rest reads Queued, and one whose entry failed reads Failed.
 */
export function getShortStatus(
  videoId: string,
  exportedMap: Record<string, boolean>,
  postedMap: Record<string, PostedPlatforms>,
  queueStates: Record<string, ShortQueueState>
): ShortStatus {
  const queueState = queueStates[videoId];
  if (queueState) return queueState;
  const posted = postedMap[videoId];
  if (posted && (posted.youtube || posted.tiktok)) return "posted";
  if (exportedMap[videoId]) return "exported";
  return "recorded";
}

export const STATUS_META: Record<
  ShortStatus,
  { label: string; icon: LucideIcon }
> = {
  recorded: { label: "Recorded", icon: Circle },
  exported: { label: "Exported", icon: Download },
  queued: { label: "Queued", icon: ListOrdered },
  posted: { label: "Posted", icon: Send },
  failed: { label: "Failed", icon: CircleAlert },
};
