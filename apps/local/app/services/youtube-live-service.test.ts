import { describe, it, expect } from "@effect/vitest";
import { listBroadcasts } from "@/services/youtube-live-service";
import {
  useFakeYouTube,
  youtube,
  type Answer,
} from "@/test-utils/fake-youtube-live";

/**
 * The Broadcast list through the app server: the stored Google grant in the
 * test database, and YouTube faked at the HTTP boundary through the YouTube
 * API URL override. No test reaches Google. The chat is
 * `broadcast-chat.test.ts`.
 */

const { storeGrant, runWithFakeYouTube } = useFakeYouTube();

const runList = () => runWithFakeYouTube(listBroadcasts);

const broadcastItem = (o: {
  id: string;
  title: string;
  scheduledStartTime?: string;
  enableAutoStart?: boolean;
  enableAutoStop?: boolean;
  liveChatId?: string;
  boundStreamId?: string;
}) => ({
  kind: "youtube#liveBroadcast",
  id: o.id,
  snippet: {
    title: o.title,
    scheduledStartTime: o.scheduledStartTime,
    liveChatId: o.liveChatId,
  },
  contentDetails: {
    enableAutoStart: o.enableAutoStart ?? true,
    enableAutoStop: o.enableAutoStop ?? true,
    boundStreamId: o.boundStreamId,
  },
});

/** Google's answer to a token granted without the scope a call needs. */
const insufficientScope: Answer = {
  status: 403,
  body: {
    error: {
      code: 403,
      message: "Request had insufficient authentication scopes.",
      errors: [
        {
          message: "Insufficient Permission",
          domain: "global",
          reason: "insufficientPermissions",
        },
      ],
      status: "PERMISSION_DENIED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
        },
      ],
    },
  },
};

describe("listBroadcasts", () => {
  it("lists the channel's active and upcoming Broadcasts, active first, then by scheduled start", async () => {
    await storeGrant();
    youtube.answers.active = {
      status: 200,
      body: {
        items: [
          broadcastItem({
            id: "live-now",
            title: "Office hours (live)",
            scheduledStartTime: "2026-10-30T15:00:00Z",
            liveChatId: "chat-live-now",
            boundStreamId: "stream-1",
          }),
        ],
      },
    };
    youtube.answers.upcoming = {
      status: 200,
      body: {
        items: [
          broadcastItem({
            id: "later",
            title: "Q&A",
            scheduledStartTime: "2026-11-02T18:00:00Z",
            enableAutoStart: false,
            liveChatId: "chat-later",
          }),
          broadcastItem({
            id: "sooner",
            title: "Office hours",
            scheduledStartTime: "2026-10-31T18:00:00Z",
            enableAutoStop: false,
            liveChatId: "chat-sooner",
          }),
        ],
      },
    };

    const answer = await runList();

    expect(answer).toEqual({
      status: "listed",
      broadcasts: [
        {
          id: "live-now",
          title: "Office hours (live)",
          scheduledStartTime: "2026-10-30T15:00:00Z",
          enableAutoStart: true,
          enableAutoStop: true,
          liveChatId: "chat-live-now",
          boundStreamId: "stream-1",
        },
        {
          id: "sooner",
          title: "Office hours",
          scheduledStartTime: "2026-10-31T18:00:00Z",
          enableAutoStart: true,
          enableAutoStop: false,
          liveChatId: "chat-sooner",
          boundStreamId: null,
        },
        {
          id: "later",
          title: "Q&A",
          scheduledStartTime: "2026-11-02T18:00:00Z",
          enableAutoStart: false,
          enableAutoStop: true,
          liveChatId: "chat-later",
          boundStreamId: null,
        },
      ],
    });
    expect(
      youtube.requests.every(
        (r) => r.authorization === "Bearer stored-access-token"
      )
    ).toBe(true);
  });

  it("asks for a reconnect when the stored grant lacks live-streaming access", async () => {
    await storeGrant();
    youtube.answers.active = insufficientScope;
    youtube.answers.upcoming = insufficientScope;

    expect(await runList()).toEqual({
      status: "needs-reconnect",
      reason: "missing-live-access",
    });
  });

  it("asks to connect when there is no stored grant, and calls YouTube not at all", async () => {
    expect(await runList()).toEqual({
      status: "needs-reconnect",
      reason: "not-connected",
    });
    expect(youtube.requests).toEqual([]);
  });

  it("fails with YouTube's message on any other error", async () => {
    await storeGrant();
    youtube.answers.active = {
      status: 500,
      body: { error: { code: 500, message: "Backend Error" } },
    };
    youtube.answers.upcoming = { status: 200, body: { items: [] } };

    await expect(runList()).rejects.toThrow(/Backend Error/);
  });
});
