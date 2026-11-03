import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import {
  createBroadcastChat,
  type BroadcastChat,
} from "@/services/broadcast-chat";
import type { BroadcastChatEvent } from "@/features/streaming/broadcast-chat";
import { useFakeYouTube, youtube } from "@/test-utils/fake-youtube-live";
import { handClock } from "@/test-utils/hand-clock";

/**
 * The picked Broadcast's **Concurrent Viewers**, read by the app server's
 * chat from a YouTube faked at the HTTP boundary (`fake-youtube-live.ts`).
 * No test reaches Google.
 */

const { storeGrant, runWithFakeYouTube } = useFakeYouTube();

let chats: BroadcastChat[] = [];
const startChat = (
  o: Partial<Parameters<typeof createBroadcastChat>[0]> = {}
) => {
  const chat = createBroadcastChat({
    reconnectMs: 20,
    maxReconnectMs: 100,
    maxStreamRetryMs: 100,
    steadyMs: 10,
    maxMessages: 500,
    ...o,
  });
  chats.push(chat);
  return chat;
};

afterEach(() => {
  for (const chat of chats) chat.end();
  chats = [];
});

const pick = (chat: BroadcastChat, p: Parameters<BroadcastChat["pick"]>[0]) =>
  runWithFakeYouTube(chat.pick(p));

/** What a Streaming tab listening from now on hears. */
const listen = (chat: BroadcastChat) => {
  const heard: BroadcastChatEvent[] = [];
  chat.subscribe((event) => heard.push(event));
  return heard;
};

/** A `videos.list` answer for one Broadcast, as YouTube sends it. */
const liveDetails = (details: Record<string, string>) => ({
  status: 200,
  body: {
    kind: "youtube#videoListResponse",
    items: [{ id: "office-hours", liveStreamingDetails: details }],
  },
});

const viewerRequests = () =>
  youtube.requests
    .filter((r) => r.path.startsWith("/youtube/v3/videos"))
    .map((r) => new URL(r.path, "http://fake"));

const viewersHeard = (heard: BroadcastChatEvent[]) =>
  heard.flatMap((e) =>
    e.type === "concurrent-viewers-changed" ? [e.concurrentViewers] : []
  );

describe("the Broadcast's Concurrent Viewers, read by the app server", () => {
  it("asks YouTube at the pick and every 30 s, keeps the last count when a read fails, and stops once YouTube says the Broadcast ended", async () => {
    await storeGrant();
    const time = handClock();
    youtube.videos.push(
      // Not live yet: no count.
      liveDetails({ scheduledStartTime: "2026-11-03T18:00:00Z" }),
      liveDetails({
        actualStartTime: "2026-11-03T18:01:00Z",
        concurrentViewers: "12",
      }),
      { status: 500, body: { error: { code: 500, message: "Backend Error" } } },
      liveDetails({
        actualStartTime: "2026-11-03T18:01:00Z",
        concurrentViewers: "15",
      }),
      liveDetails({
        actualStartTime: "2026-11-03T18:01:00Z",
        actualEndTime: "2026-11-03T19:00:00Z",
      })
    );
    const chat = startChat({ concurrentViewersEveryMs: 30_000 });
    const heard = listen(chat);
    const pickedAt = time.now();

    await runWithFakeYouTube(
      Effect.withClock(
        chat.pick({ broadcastId: "office-hours", liveChatId: null }),
        time.clock
      )
    );
    for (let read = 1; read < 5; read++) {
      await time.whenAsleep();
      await vi.waitFor(() => expect(viewerRequests()).toHaveLength(read));
      time.wakeNext();
    }
    await vi.waitFor(() => expect(viewersHeard(heard)).toEqual([12, 15, null]));

    // The failed read kept 12: the count went 12, 15, then none once ended.
    expect(time.now() - pickedAt).toBe(4 * 30_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Ended: no fifth pause, no sixth read.
    expect(viewerRequests()).toHaveLength(5);
    const [first] = viewerRequests();
    expect(first!.searchParams.get("part")).toBe("liveStreamingDetails");
    expect(first!.searchParams.get("id")).toBe("office-hours");
  });

  it("tells a Streaming tab that listens later the count at once, and End Stream stops the reads and forgets it", async () => {
    await storeGrant();
    youtube.videos.push(
      liveDetails({ concurrentViewers: "7" }),
      liveDetails({ concurrentViewers: "8" })
    );
    const chat = startChat({ concurrentViewersEveryMs: 60_000 });
    await pick(chat, { broadcastId: "office-hours", liveChatId: null });
    await vi.waitFor(() => expect(viewerRequests()).toHaveLength(1));

    await vi.waitFor(() =>
      expect(listen(chat)).toEqual([
        {
          type: "chat-attached",
          chat: {
            broadcastId: "office-hours",
            connection: { state: "over", reason: "no-chat" },
            messages: [],
          },
        },
        {
          type: "concurrent-viewers-changed",
          broadcastId: "office-hours",
          concurrentViewers: 7,
        },
      ])
    );

    chat.end();
    expect(listen(chat)).toEqual([
      {
        type: "chat-attached",
        chat: {
          broadcastId: null,
          connection: { state: "idle" },
          messages: [],
        },
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(viewerRequests()).toHaveLength(1);
  });

  it("never asks for the count unless told how often", async () => {
    await storeGrant();
    const chat = startChat();
    await pick(chat, { broadcastId: "office-hours", liveChatId: null });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(viewerRequests()).toEqual([]);
  });
});
