import { listBroadcasts } from "@/services/youtube-live-service";
import { makeLoader } from "@/services/route-action.server";

/**
 * The Streaming tab's Broadcast picker: the channel's active and upcoming
 * Broadcasts, or why Google needs reconnecting first.
 */
export const loader = makeLoader({
  errors: { YouTubeLiveError: 502 },
  effect: () => listBroadcasts,
});
