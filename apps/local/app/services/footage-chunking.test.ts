import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { findSilenceInVideo } from "./silence-detection";
import type { FFmpegCommandsService } from "./ffmpeg-commands";
import {
  mergeChunkTranscripts,
  planChunkBoundaries,
  sliceTranscriptText,
  sliceTranscriptWords,
} from "./footage-chunking";

/**
 * The chunk-boundary + timestamp-merge algorithm, tested as pure functions —
 * no real ffmpeg and no Whisper. Where a boundary is derived from detected
 * silence we drive it through `findSilenceInVideo` with a mocked
 * FFmpegCommandsService (mirroring silence-detection.test.ts), so the same
 * silencedetect-parsing path that production uses feeds the planner.
 */

function mockFFmpeg(opts: {
  fps: number;
  silenceOutput: string;
}): FFmpegCommandsService {
  return {
    getFPS: () => Effect.succeed(opts.fps),
    detectSilence: () => Effect.succeed(opts.silenceOutput),
  } as unknown as FFmpegCommandsService;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <A>(effect: Effect.Effect<A, any, any>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(Effect.provide(NodeContext.layer)) as Effect.Effect<A>
  );

describe("planChunkBoundaries", () => {
  it("cuts at the silence point nearest the target, not at a fixed interval", () => {
    // Target 1620s (27min). Silence at 1600 and 1650 — 1600 is closer to 1620.
    const boundaries = planChunkBoundaries({
      durationSeconds: 3600,
      silencePoints: [1600, 1650, 3200],
      targetChunkSeconds: 1620,
    });

    expect(boundaries).toEqual([
      { start: 0, end: 1600 },
      { start: 1600, end: 3600 },
    ]);
    // The chosen boundary is a genuine silence point, near the target.
    expect([1600, 1650]).toContain(boundaries[0]!.end);
    expect(Math.abs(boundaries[0]!.end - 1620)).toBeLessThan(60);
  });

  it("splits a very long file into multiple chunks, each landing on silence", () => {
    const boundaries = planChunkBoundaries({
      durationSeconds: 6000,
      silencePoints: [1590, 1610, 3150, 3300, 4800],
      targetChunkSeconds: 1620,
    });

    expect(boundaries).toEqual([
      { start: 0, end: 1610 },
      { start: 1610, end: 3300 },
      { start: 3300, end: 4800 },
      { start: 4800, end: 6000 },
    ]);
    // Every internal boundary is one of the supplied silence points.
    for (const b of boundaries.slice(0, -1)) {
      expect([1590, 1610, 3150, 3300, 4800]).toContain(b.end);
    }
  });

  it("falls back to a hard cut at the target when no silence is in the window", () => {
    const boundaries = planChunkBoundaries({
      durationSeconds: 3600,
      silencePoints: [10, 20], // all far outside the window around 1620
      targetChunkSeconds: 1620,
    });

    expect(boundaries).toEqual([
      { start: 0, end: 1620 },
      { start: 1620, end: 3600 },
    ]);
  });

  it("returns a single chunk when the file is shorter than 1.5× the target", () => {
    expect(
      planChunkBoundaries({
        durationSeconds: 1800,
        silencePoints: [900],
        targetChunkSeconds: 1620,
      })
    ).toEqual([{ start: 0, end: 1800 }]);
  });

  it("derives its silence points from findSilenceInVideo's speaking clips", async () => {
    // Two speaking gaps: 2.0–5.07 and (after a silence) a later clip. The end
    // of a speaking clip is where silence begins — a legal cut point.
    const silenceOutput = [
      "[silencedetect @ 0x1] silence_start: 0",
      "[silencedetect @ 0x1] silence_end: 2.0 | silence_duration: 2.0",
      "[silencedetect @ 0x1] silence_start: 5.0",
      "[silencedetect @ 0x1] silence_end: 30.0 | silence_duration: 25.0",
      "[silencedetect @ 0x1] silence_start: 33.0",
      "[silencedetect @ 0x1] silence_end: 34.0 | silence_duration: 1.0",
    ].join("\n");
    const ffmpeg = mockFFmpeg({ fps: 30, silenceOutput });

    const { clips } = await run(findSilenceInVideo(ffmpeg, "/test/video.mkv"));
    const silencePoints = clips.map((c) => c.endTime);

    // Target 5s so the single silence point (~5.07) is the natural boundary.
    const boundaries = planChunkBoundaries({
      durationSeconds: 34,
      silencePoints,
      targetChunkSeconds: 5,
    });

    expect(boundaries[0]!.start).toBe(0);
    expect(silencePoints).toContain(boundaries[0]!.end);
    expect(boundaries.at(-1)!.end).toBe(34);
  });
});

describe("mergeChunkTranscripts", () => {
  it("offsets every word and segment by its chunk's start", () => {
    const merged = mergeChunkTranscripts([
      {
        offset: 0,
        words: [{ start: 0, end: 0.5, text: "hello" }],
        segments: [{ start: 0, end: 0.5, text: "hello" }],
      },
      {
        offset: 100,
        words: [
          { start: 1, end: 1.5, text: "world" },
          { start: 2, end: 2.5, text: "again" },
        ],
        segments: [{ start: 1, end: 2.5, text: "world again" }],
      },
    ]);

    expect(merged.words).toEqual([
      { start: 0, end: 0.5, text: "hello" },
      { start: 101, end: 101.5, text: "world" },
      { start: 102, end: 102.5, text: "again" },
    ]);
    expect(merged.segments).toEqual([
      { start: 0, end: 0.5, text: "hello" },
      { start: 101, end: 102.5, text: "world again" },
    ]);
  });

  it("is a no-op offset for a single chunk at zero", () => {
    const merged = mergeChunkTranscripts([
      {
        offset: 0,
        words: [{ start: 3, end: 4, text: "x" }],
        segments: [],
      },
    ]);
    expect(merged.words).toEqual([{ start: 3, end: 4, text: "x" }]);
    expect(merged.segments).toEqual([]);
  });
});

describe("sliceTranscriptWords", () => {
  const transcript = {
    words: [
      { start: 10, end: 11, text: "the" },
      { start: 11, end: 12, text: "quick" },
      { start: 12, end: 13, text: "brown" },
      { start: 13, end: 14, text: "fox" },
    ],
    segments: [{ start: 10, end: 14, text: " the quick brown fox" }],
  };

  it("re-bases the overlapping words so 0 is the window's start", () => {
    expect(sliceTranscriptWords(transcript, 11, 13)).toEqual([
      { start: 0, end: 1, text: "quick" },
      { start: 1, end: 2, text: "brown" },
    ]);
  });

  it("clamps a word straddling an edge into the window", () => {
    // [11.5, 12.5) overlaps "quick" (11-12) and "brown" (12-13); neither may
    // report an offset outside the 1s window.
    expect(sliceTranscriptWords(transcript, 11.5, 12.5)).toEqual([
      { start: 0, end: 0.5, text: "quick" },
      { start: 0.5, end: 1, text: "brown" },
    ]);
  });

  it("has no words when the transcript has only segments", () => {
    expect(
      sliceTranscriptWords({ words: [], segments: transcript.segments }, 10, 14)
    ).toEqual([]);
  });

  it("is empty when the window overlaps nothing", () => {
    expect(sliceTranscriptWords(transcript, 100, 200)).toEqual([]);
  });
});

describe("sliceTranscriptText", () => {
  const transcript = {
    words: [
      { start: 0, end: 1, text: "the" },
      { start: 1, end: 2, text: "quick" },
      { start: 2, end: 3, text: "brown" },
      { start: 3, end: 4, text: "fox" },
    ],
    segments: [{ start: 0, end: 4, text: " the quick brown fox" }],
  };

  it("returns the words overlapping the window, space-joined", () => {
    expect(sliceTranscriptText(transcript, 1, 3)).toBe("quick brown");
  });

  it("includes a word that straddles the window edge", () => {
    // [1.5, 2.5) overlaps "quick" (1–2) and "brown" (2–3).
    expect(sliceTranscriptText(transcript, 1.5, 2.5)).toBe("quick brown");
  });

  it("falls back to overlapping segments when there are no words", () => {
    expect(
      sliceTranscriptText({ words: [], segments: transcript.segments }, 0, 4)
    ).toBe("the quick brown fox");
  });

  it("is empty when the window overlaps nothing", () => {
    expect(sliceTranscriptText(transcript, 10, 20)).toBe("");
  });
});
