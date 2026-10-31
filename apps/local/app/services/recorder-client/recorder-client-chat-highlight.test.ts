import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Either } from "effect";
import type { ChatSnapshot } from "@/features/streaming/broadcast-chat";
import { CHAT_HIGHLIGHTS_UNAVAILABLE } from "@/services/card-browser.server";
import { clock } from "recorder-service/test-utils/service-harness";
import { testDb } from "../clip-service-test-setup";
import {
  cardBrowserFile,
  ready,
  setupGoLiveTests,
} from "./go-live-test-harness";
import { hideChatHighlight, showChatHighlight } from "./chat-highlight.server";

/**
 * CHAT HIGHLIGHTS end to end (spec #2445, stories 69–82), through Go Live
 * (`go-live-test-harness.ts`): the scripted launcher stands in for the
 * stream ffmpeg.exe (which reads the card feed) and for the card server.
 */

setupGoLiveTests();

// The recorder's Windows clock moves on in real time, so the card feed's
// frames (one per 1/60 s of it) keep coming.
let ticking: ReturnType<typeof setInterval>;
beforeEach(() => {
  ticking = setInterval(() => (clock.ms += 5), 5);
});
afterEach(() => clearInterval(ticking));

/** Two fake viewers' messages in the picked Broadcast's chat. */
const chat: ChatSnapshot = {
  broadcastId: "office-hours",
  connection: { state: "streaming" },
  messages: [
    {
      id: "msg-1",
      author: "@fake_viewer_42",
      text: "Does this work with Effect?",
      publishedAt: "2026-10-31T18:01:00Z",
    },
    {
      id: "msg-2",
      author: "@another_fake",
      text: "What font is that?",
      publishedAt: "2026-10-31T18:02:00Z",
    },
  ],
};

/** Live, with the stream reading its card feed. */
const live = async () => {
  const r = await ready();
  expect(Either.isRight(await r.goLive())).toBe(true);
  await vi.waitFor(() =>
    expect(r.windows.cardFeeds[0]?.bytes() ?? 0).toBeGreaterThan(0)
  );
  // The card server starts once the stream pushes its first frames.
  expect(r.windows.cardServers).toHaveLength(0);
  r.windows.streams[0]!.stdout("frame=60\nprogress=continue\n");
  await vi.waitFor(() => expect(r.windows.cardServers).toHaveLength(1));
  const show = (messageId: string) =>
    Effect.runPromise(
      showChatHighlight({
        client: r.client,
        chat,
        videoId: r.video.id,
        messageId,
        cardBrowser: cardBrowserFile(),
      })
    );
  const hide = (highlightId: string) =>
    Effect.runPromise(hideChatHighlight(r.client, r.video.id, highlightId));
  const rows = () =>
    testDb.query.chatHighlights.findMany({
      orderBy: (h, { asc }) => asc(h.shownAtMs),
    });
  return { ...r, show, hide, rows };
};

/** The streamed Recording Session's logged events. */
const eventsOf = (folder: string) => {
  const [dir] = fs.readdirSync(folder);
  return fs
    .readFileSync(path.join(folder, dir!, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
};

describe("Chat Highlights", () => {
  it("stores each one with the service's stamps, on the picture's 1/60 grid; another click replaces it; one still showing at End Stream is closed with End Stream's time", async () => {
    const r = await live();

    const first = await r.show("msg-1");
    await vi.waitFor(async () => expect(await r.rows()).toHaveLength(1));
    const hid = await r.hide(first.highlightId);
    const second = await r.show("msg-2");
    const third = await r.show("msg-1");
    // The take has reached 30 s of picture by End Stream.
    r.windows
      .recorder("camera")
      .stdout("frame=900\nout_time_us=30000000\nprogress=continue\n");
    await vi.waitFor(() => expect(r.heard.length).toBeGreaterThan(0));
    await r.client.endStream(r.video.id);

    await vi.waitFor(() =>
      expect(eventsOf(r.folder).map((e) => e.type)).toContain(
        "recording-stopped"
      )
    );
    const events = eventsOf(r.folder);
    const t0Ms = events[0]!.t0Ms as number;
    const stoppedAt = events.find((e) => e.type === "recording-stopped")!
      .fileTime as number;
    await vi.waitFor(async () =>
      expect((await r.rows()).every((h) => h.hiddenAtMs !== null)).toBe(true)
    );
    const [one, two, three] = await r.rows();
    const session = events[0]!.recordingSessionId;
    expect(one).toMatchObject({
      id: first.highlightId,
      videoId: r.video.id,
      recordingSessionId: session,
      broadcastId: "office-hours",
      messageId: "msg-1",
      author: "@fake_viewer_42",
      text: "Does this work with Effect?",
      shownAtMs: first.shownAtMs,
      hiddenAtMs: hid.hiddenAtMs,
    });
    expect(two).toMatchObject({ id: second.highlightId, messageId: "msg-2" });
    // Replaced: the second's exit (nine frames, 150 ms), then the third's entrance.
    expect(two!.hiddenAtMs).toBeCloseTo(third.shownAtMs - (9 * 1000) / 60, 6);
    // Still showing at End Stream: closed with the stop's time.
    expect(three).toMatchObject({ id: third.highlightId, messageId: "msg-1" });
    expect(stoppedAt).toBe(30);
    expect(three!.hiddenAtMs).toBe(t0Ms + stoppedAt * 1000);
    // Every stamp is a card frame's: T0 plus a whole number of 1/60 s.
    for (const at of [one!.shownAtMs, one!.hiddenAtMs!, two!.shownAtMs]) {
      const frames = ((at - t0Ms) * 60) / 1000;
      expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-3);
    }
    // The card server drew each card from the chat as relayed.
    expect(r.windows.cardServers[0]!.written).toContain(
      '"author":"@another_fake","text":"What font is that?"'
    );
    // Never an Overlay, so no Export Hash moves.
    expect(await testDb.query.overlays.findMany()).toEqual([]);
  });

  it("keeps the stream and the take going when the card server dies; the next click starts it again", async () => {
    const r = await live();

    r.windows.cardServers[0]!.exit(1);
    const shown = await r.show("msg-1");

    expect(r.windows.cardServers).toHaveLength(2);
    await vi.waitFor(async () =>
      expect((await r.rows()).map((h) => h.id)).toEqual([shown.highlightId])
    );
    expect(r.windows.streams[0]!.running).toBe(true);
    expect(r.windows.recorder("camera").running).toBe(true);
    await r.client.endStream(r.video.id);
  });

  it("carries the card on to a relaunched stream process, on the same clock as its picture", async () => {
    const r = await live();

    r.windows.streams[0]!.exit(1);
    await vi.waitFor(() => expect(r.windows.streams).toHaveLength(2));

    // The relaunched picture starts where the feeds are; so does its card.
    const graph = r.windows.streams[1]!.launch.args.join(" ");
    const canvasStart = graph.match(/r=60,setpts=PTS\+([\d.]+)\/TB/)?.[1];
    expect(canvasStart).toBeDefined();
    expect(graph).toContain(`[2:v]setpts=PTS+${canvasStart}/TB,`);
    // And a click shows on it, once its frames reach the picture's start.
    await vi.waitFor(
      () => expect(r.windows.cardFeeds[1]!.bytes()).toBeGreaterThan(0),
      { timeout: 10_000 }
    );
    const shown = await r.show("msg-2");
    expect(shown.shownAtMs).toBeGreaterThan(0);
    expect(r.windows.recorder("camera").running).toBe(true);
    await r.client.endStream(r.video.id);
  });

  it("draws the card on the CPU over the picture read back from the GPU, never from a card uploaded to it (#2462)", async () => {
    const r = await live();

    // On the rig, a card uploaded to CUDA showed its state 2 frames early:
    // its upload pool held 2 frames, and the next upload overwrote the one
    // the blend was still to read.
    const graph = r.windows.streams[0]!.launch.args.join(" ");
    const cardChain = graph.split(";").find((c) => c.startsWith("[2:v]"));
    expect(cardChain).not.toContain("hwupload_cuda");
    expect(graph).toMatch(
      /\[live_selected\]hwdownload,format=yuv420p\[\w+\];\[\w+\]\[live_card\]overlay=/
    );
    expect(graph).not.toMatch(/\[live_card\]overlay_cuda/);
    await r.client.endStream(r.video.id);
  });

  it("goes live without the card server's browser, and refuses only the Chat Highlight, saying the stream and recording are unaffected", async () => {
    const r = await ready();
    const missing = "/nowhere/chrome-headless-shell";

    expect(Either.isRight(await r.goLive())).toBe(true);
    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-started")
    );
    const answer = await Effect.runPromise(
      Effect.either(
        showChatHighlight({
          client: r.client,
          chat,
          videoId: r.video.id,
          messageId: "msg-1",
          cardBrowser: missing,
        })
      )
    );

    expect(Either.isLeft(answer) && answer.left.message).toBe(
      CHAT_HIGHLIGHTS_UNAVAILABLE
    );
    // Refused on the app server: no card is ever asked of a card server.
    expect(r.windows.cardServers.map((s) => s.written).join("")).not.toContain(
      "Does this work with Effect?"
    );
    expect(r.windows.recorder("camera").running).toBe(true);
    await r.client.endStream(r.video.id);
  });
});
