import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "@effect/vitest";
import { createNewBroadcast } from "@/services/new-broadcast.server";
import { useFakeYouTube, youtube } from "@/test-utils/fake-youtube-live";

/**
 * **New Broadcast** on the app server, as its route runs it: YouTube faked
 * at the HTTP boundary, the Stream Key in a throwaway `.env`. No test
 * reaches Google.
 */

const { storeGrant, runWithFakeYouTube } = useFakeYouTube();

const KEY = "fake-key-n3w-b40d";

const envFile = (contents: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "new-broadcast-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, contents);
  return file;
};

const settings = {
  title: "Office hours",
  description: "",
  privacyStatus: "public" as const,
  latencyPreference: "low" as const,
};

const created = {
  status: 200,
  body: {
    id: "new-one",
    snippet: {
      title: "Office hours",
      scheduledStartTime: "2026-11-04T10:05:00Z",
      liveChatId: "chat-new-one",
    },
    contentDetails: {
      enableAutoStart: true,
      enableAutoStop: true,
      latencyPreference: "low",
    },
    status: { privacyStatus: "public" },
  },
};

const create = (envPath: string | undefined) =>
  runWithFakeYouTube(
    createNewBroadcast({
      settings,
      submittedAt: new Date("2026-11-04T10:00:00Z"),
      envPath,
    })
  );

const callsMade = () =>
  youtube.requests.map((r) => `${r.method} ${r.path.split("?")[0]}`);

describe("New Broadcast", () => {
  it("inserts the Broadcast, turns monetization off, binds it to the Stream Key's stream, and answers it bound", async () => {
    await storeGrant();
    youtube.calls["POST /youtube/v3/liveBroadcasts"] = [created];
    youtube.calls["PUT /youtube/v3/liveBroadcasts"] = [
      { status: 200, body: { id: "new-one" } },
    ];
    youtube.calls["GET /youtube/v3/liveStreams"] = [
      {
        status: 200,
        body: {
          items: [
            { id: "other", cdn: { ingestionInfo: { streamName: "other" } } },
            { id: "keys-stream", cdn: { ingestionInfo: { streamName: KEY } } },
          ],
        },
      },
    ];
    youtube.calls["POST /youtube/v3/liveBroadcasts/bind"] = [
      { status: 200, body: { id: "new-one" } },
    ];

    const answer = await create(envFile(`YOUTUBE_STREAM_KEY=${KEY}\n`));

    expect(answer).toEqual({
      status: "created",
      broadcast: {
        id: "new-one",
        title: "Office hours",
        scheduledStartTime: "2026-11-04T10:05:00Z",
        enableAutoStart: true,
        enableAutoStop: true,
        liveChatId: "chat-new-one",
        boundStreamId: "keys-stream",
        latencyPreference: "low",
        privacyStatus: "public",
      },
      monetization: { status: "off" },
      bind: { status: "bound" },
    });
    expect(callsMade()).toEqual([
      "POST /youtube/v3/liveBroadcasts",
      "PUT /youtube/v3/liveBroadcasts",
      "GET /youtube/v3/liveStreams",
      "POST /youtube/v3/liveBroadcasts/bind",
    ]);
    expect(
      youtube.requests.find((r) => r.path.includes("/bind"))?.path
    ).toContain("streamId=keys-stream");
  });

  it("still answers the Broadcast when monetization could not be turned off and there is no Stream Key to bind it with", async () => {
    await storeGrant();
    youtube.calls["POST /youtube/v3/liveBroadcasts"] = [created];
    youtube.calls["PUT /youtube/v3/liveBroadcasts"] = [
      { status: 500, body: { error: { code: 500, message: "Backend Error" } } },
    ];

    const answer = await create(envFile("DATABASE_URL=postgres://nowhere\n"));

    expect(answer).toMatchObject({
      status: "created",
      broadcast: { id: "new-one", boundStreamId: null },
      monetization: {
        status: "failed",
        message: expect.stringContaining("Backend Error"),
      },
      bind: {
        status: "not-bound",
        reason: expect.stringContaining("No Stream Key"),
      },
    });
    expect(callsMade()).toEqual([
      "POST /youtube/v3/liveBroadcasts",
      "PUT /youtube/v3/liveBroadcasts",
    ]);
  });

  it("answers not-bound, saying why, when no stream on the channel uses the Stream Key", async () => {
    await storeGrant();
    youtube.calls["POST /youtube/v3/liveBroadcasts"] = [created];
    youtube.calls["PUT /youtube/v3/liveBroadcasts"] = [
      { status: 200, body: { id: "new-one" } },
    ];
    youtube.calls["GET /youtube/v3/liveStreams"] = [
      { status: 200, body: { items: [] } },
    ];

    const answer = await create(envFile(`YOUTUBE_STREAM_KEY=${KEY}\n`));

    expect(answer).toMatchObject({
      status: "created",
      bind: {
        status: "not-bound",
        reason: expect.stringContaining("No YouTube stream on the channel"),
      },
    });
    // The Stream Key is never put in an answer.
    expect(JSON.stringify(answer)).not.toContain(KEY);
  });

  it("fails, doing nothing more, when YouTube refuses the insert", async () => {
    await storeGrant();
    youtube.calls["POST /youtube/v3/liveBroadcasts"] = [
      {
        status: 400,
        body: { error: { code: 400, message: "Invalid latency preference" } },
      },
    ];

    await expect(
      create(envFile(`YOUTUBE_STREAM_KEY=${KEY}\n`))
    ).rejects.toThrow(/Invalid latency preference/);
    expect(callsMade()).toEqual(["POST /youtube/v3/liveBroadcasts"]);
  });
});
