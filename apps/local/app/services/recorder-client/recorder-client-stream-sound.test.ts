import { describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { MIC_EQ_SETTING_ID } from "@cvm/core/features/videos/recorder";
import type { fakeWindows } from "recorder-service/test-utils/fake-windows";
import type { Launch } from "recorder-service/launcher";
import { testDb } from "../clip-service-test-setup";
import {
  isFfmpeg,
  isStream,
  isStreamedWriter,
  ready,
  setupGoLiveTests,
} from "./go-live-test-harness";

/**
 * The Live Stream's sound (spec #2445, stories 31–35), end to end through Go
 * Live (`go-live-test-harness.ts`): what the stream process is launched
 * with, for a given Mic Offset and Mic EQ.
 */

setupGoLiveTests();

describe("the stream sounds like the export", () => {
  /** The stream's audio chain: its filters from the mic input to `[a]`. */
  const audioChain = (args: readonly string[]) =>
    args
      .join(" ")
      .match(/\[1:a\](.*?)\[a\]/)![1]!
      .split(",");
  const streamLaunch = (r: { windows: ReturnType<typeof fakeWindows> }) =>
    r.windows.launched.find(isStream) as Extract<Launch, { tool: "ffmpeg" }>;
  const LIMITER = "alimiter=limit=0.794:attack=5:release=50:level=0:latency=1";

  it("plays the mic through the Mic Offset, the saved Mic EQ, +16 dB and a zero-latency limiter, in that order; the raw mic is untouched", async () => {
    const r = await ready();
    await testDb
      .insert(schema.micEqSettings)
      .values({ id: MIC_EQ_SETTING_ID, lowDb: -3, midDb: 0, highDb: -6 });

    expect(Either.isRight(await r.goLive())).toBe(true);

    const args = streamLaunch(r).args;
    const chain = audioChain(args);
    // The calibrated pair's Mic Offset, 142 ms (`freshCalibration`).
    expect(chain[0]).toBe("adelay=142:all=1");
    expect(chain[1]).toBe("aresample=48000");
    expect(chain[2]).toMatch(/^aiir=z=\S+( \S+)+:p=/);
    expect(chain.slice(3)).toEqual([
      "volume=16dB",
      LIMITER,
      "aresample=async=1000",
    ]);
    expect(args.join(" ")).not.toMatch(/loudnorm|dynaudnorm|acompressor/);
    // The camera writer's mic (mic.mkv and the stream's feed) is raw.
    const writer = r.windows.launched.find(isStreamedWriter);
    if (!writer || !isFfmpeg(writer)) throw new Error("no streamed writer");
    expect(writer.args.join(" ")).not.toMatch(/aiir|volume=|alimiter/);
    await r.client.endStream(r.video.id);
  });

  it("adds no EQ filter for a flat Mic EQ, and reads it once: changing it mid-stream leaves the running stream alone", async () => {
    const r = await ready();
    await testDb
      .insert(schema.micEqSettings)
      .values({ id: MIC_EQ_SETTING_ID, lowDb: 0, midDb: 0, highDb: 0 });
    await r.goLive();
    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-started")
    );
    const before = [...streamLaunch(r).args];
    expect(audioChain(before)).toEqual([
      "adelay=142:all=1",
      "volume=16dB",
      LIMITER,
      "aresample=async=1000",
    ]);

    await testDb
      .update(schema.micEqSettings)
      .set({ lowDb: 3 })
      .where(eq(schema.micEqSettings.id, MIC_EQ_SETTING_ID));
    r.windows.streams[0]!.stdout("frame=60\nprogress=continue\n");
    await vi.waitFor(() =>
      expect(r.streamStatuses().at(-1)).toEqual({ kind: "live" })
    );

    expect(r.windows.launched.filter(isStream)).toHaveLength(1);
    expect(streamLaunch(r).args).toEqual(before);
    await r.client.endStream(r.video.id);
  });
});
