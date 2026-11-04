import { describe, it, expect } from "@effect/vitest";
import { listBroadcasts } from "@/services/youtube-live-service";
import {
  createBroadcast,
  turnMonetizationOff,
} from "@/services/youtube-live-broadcast-writes";
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

/**
 * A failed list gives up on its other call, which, unless aborted before it
 * went, still reaches the fake YouTube a moment later: let it land here,
 * never in the next test.
 */
const otherListSettled = () =>
  new Promise((resolve) => setTimeout(resolve, 100));

const broadcastItem = (o: {
  id: string;
  title: string;
  scheduledStartTime?: string;
  enableAutoStart?: boolean;
  enableAutoStop?: boolean;
  liveChatId?: string;
  boundStreamId?: string;
  latencyPreference?: string;
  privacyStatus?: string;
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
    latencyPreference: o.latencyPreference,
  },
  status: { privacyStatus: o.privacyStatus },
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
  it("lists the channel's active and upcoming Broadcasts, active first, then by scheduled start, with each one's latency and privacy", async () => {
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
            latencyPreference: "low",
            privacyStatus: "public",
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
            latencyPreference: "somethingNew",
            privacyStatus: "private",
          }),
          broadcastItem({
            id: "sooner",
            title: "Office hours",
            scheduledStartTime: "2026-10-31T18:00:00Z",
            enableAutoStop: false,
            liveChatId: "chat-sooner",
            latencyPreference: "ultraLow",
            privacyStatus: "unlisted",
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
          latencyPreference: "low",
          privacyStatus: "public",
        },
        {
          id: "sooner",
          title: "Office hours",
          scheduledStartTime: "2026-10-31T18:00:00Z",
          enableAutoStart: true,
          enableAutoStop: false,
          liveChatId: "chat-sooner",
          boundStreamId: null,
          latencyPreference: "ultraLow",
          privacyStatus: "unlisted",
        },
        {
          id: "later",
          title: "Q&A",
          scheduledStartTime: "2026-11-02T18:00:00Z",
          enableAutoStart: false,
          enableAutoStop: true,
          liveChatId: "chat-later",
          boundStreamId: null,
          // A setting CVM doesn't know is not said: End Stream waits the longest.
          latencyPreference: null,
          privacyStatus: "private",
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
    await otherListSettled();
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
    await otherListSettled();
  });
});

describe("createBroadcast", () => {
  const settings = {
    title: "Office hours",
    description: "Questions answered live.",
    privacyStatus: "unlisted" as const,
    latencyPreference: "ultraLow" as const,
  };
  const submittedAt = new Date("2026-11-04T10:00:00Z");

  it("inserts a Broadcast not made for kids, with auto-start, auto-stop, the latency and a start 5 minutes after submit, and answers it as YouTube does", async () => {
    await storeGrant();
    youtube.calls["POST /youtube/v3/liveBroadcasts"] = [
      {
        status: 200,
        body: broadcastItem({
          id: "new-one",
          title: "Office hours",
          scheduledStartTime: "2026-11-04T10:05:00Z",
          liveChatId: "chat-new-one",
          latencyPreference: "ultraLow",
          privacyStatus: "unlisted",
        }),
      },
    ];

    const answer = await runWithFakeYouTube(
      createBroadcast(settings, submittedAt)
    );

    expect(answer).toEqual({
      status: "created",
      broadcast: {
        id: "new-one",
        title: "Office hours",
        scheduledStartTime: "2026-11-04T10:05:00Z",
        enableAutoStart: true,
        enableAutoStop: true,
        liveChatId: "chat-new-one",
        boundStreamId: null,
        latencyPreference: "ultraLow",
        privacyStatus: "unlisted",
      },
    });
    expect(youtube.requests).toEqual([
      {
        method: "POST",
        path: "/youtube/v3/liveBroadcasts?part=snippet%2CcontentDetails%2Cstatus",
        authorization: "Bearer stored-access-token",
        body: {
          snippet: {
            title: "Office hours",
            description: "Questions answered live.",
            scheduledStartTime: "2026-11-04T10:05:00.000Z",
          },
          status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
          contentDetails: {
            enableAutoStart: true,
            enableAutoStop: true,
            latencyPreference: "ultraLow",
          },
        },
      },
    ]);
  });

  it("asks to connect when there is no stored grant, and creates nothing", async () => {
    expect(
      await runWithFakeYouTube(createBroadcast(settings, submittedAt))
    ).toEqual({ status: "needs-reconnect", reason: "not-connected" });
    expect(youtube.requests).toEqual([]);
  });

  it("asks for a reconnect when the stored grant lacks live-streaming access", async () => {
    await storeGrant();
    youtube.calls["POST /youtube/v3/liveBroadcasts"] = [insufficientScope];

    expect(
      await runWithFakeYouTube(createBroadcast(settings, submittedAt))
    ).toEqual({ status: "needs-reconnect", reason: "missing-live-access" });
  });
});

describe("turnMonetizationOff", () => {
  const turnOff = () => runWithFakeYouTube(turnMonetizationOff("new-one"));

  it("updates only the Broadcast's monetizationDetails, turning ads off", async () => {
    await storeGrant();
    youtube.calls["PUT /youtube/v3/liveBroadcasts"] = [
      { status: 200, body: { id: "new-one" } },
    ];

    expect(await turnOff()).toEqual({ status: "off" });
    expect(youtube.requests).toEqual([
      {
        method: "PUT",
        path: "/youtube/v3/liveBroadcasts?part=monetizationDetails",
        authorization: "Bearer stored-access-token",
        body: {
          id: "new-one",
          monetizationDetails: { adsMonetizationStatus: "off" },
        },
      },
    ]);
  });

  it("answers not-eligible when the channel is not in the YouTube Partner Program", async () => {
    await storeGrant();
    youtube.calls["PUT /youtube/v3/liveBroadcasts"] = [
      {
        status: 403,
        body: {
          error: {
            code: 403,
            message: "Monetization details cannot be modified.",
            errors: [{ reason: "monetizationDetailsModificationNotAllowed" }],
          },
        },
      },
    ];

    expect(await turnOff()).toEqual({ status: "not-eligible" });
  });

  it("answers failed with YouTube's message on any other error", async () => {
    await storeGrant();
    youtube.calls["PUT /youtube/v3/liveBroadcasts"] = [
      { status: 500, body: { error: { code: 500, message: "Backend Error" } } },
    ];

    expect(await turnOff()).toEqual({
      status: "failed",
      message: expect.stringContaining("Backend Error"),
    });
  });
});
