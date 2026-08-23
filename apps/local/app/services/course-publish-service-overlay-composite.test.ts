import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import { asc, eq } from "drizzle-orm";
import { CoursePublishService } from "@/services/course-publish-service";
import { clips as clipsTable, overlays as overlaysTable } from "@/db/schema";
import {
  COMPOSITED_BYTES_MARKER,
  DEFAULT_RENDERED_BYTES,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
  testDb,
} from "./course-publish-service-test-setup";
import { LONG_PAUSE_DURATION_IN_SECONDS } from "./export-duration-check";
import { computeDefinitionCardContentHash } from "./overlay-render-cache";

setupPublishServiceTests();

/**
 * Definition Cards in a real course export.
 *
 * The Video's own Clips, Overlays, Export Hash and export step are all real
 * here. The two fakes are the two things a test may never run: the Chromium
 * render behind the Overlay Render Cache, and ffmpeg itself. So what these
 * tests pin down is everything BETWEEN them — which cards are asked for, where
 * on the flattened timeline each one lands, and whether the pass runs at all.
 *
 * The test Course's Video 0 is two Clips: 0→10s and 15→25s. The second is the
 * last, so it carries the final-video padding; neither has a long Pause.
 */

const exportVideo = (videoId: string) =>
  Effect.gen(function* () {
    const svc = yield* CoursePublishService;
    return yield* svc.exportVideo(videoId);
  });

/** Give a Video's `index`-th Clip an Overlay carrying a Definition Card. */
const addOverlay = async (
  videoId: string,
  clipIndex: number,
  overlay: {
    at: number;
    durationInSeconds: number;
    title: string;
    description: string;
  }
) => {
  const videoClips = await testDb
    .select({ id: clipsTable.id })
    .from(clipsTable)
    .where(eq(clipsTable.videoId, videoId))
    .orderBy(asc(clipsTable.order));
  await testDb
    .insert(overlaysTable)
    .values({ clipId: videoClips[clipIndex]!.id, ...overlay });
};

describe("Definition Cards in a course export", () => {
  it("renders each card and composites them all in one pass", async () => {
    const { video, run, cardRenderRequests, compositeRuns } = await setup();

    await addOverlay(video.id, 0, {
      at: 2,
      durationInSeconds: 4,
      title: "Monomorphism",
      description: "Never collapses two inputs into one output.",
    });
    await addOverlay(video.id, 1, {
      at: 1,
      durationInSeconds: 3,
      title: "Functor",
      description: "Maps structure without changing shape.",
    });

    await run(exportVideo(video.id));

    expect(cardRenderRequests.map((r) => r.content.title)).toEqual([
      "Monomorphism",
      "Functor",
    ]);
    // One pass, two nodes — never one pass per Overlay.
    expect(compositeRuns).toHaveLength(1);
    expect(compositeRuns[0]!.overlays).toHaveLength(2);
  });

  it("converts each Clip-relative anchor to the Video's own timeline", async () => {
    const { video, run, compositeRuns } = await setup();

    await addOverlay(video.id, 0, {
      at: 2,
      durationInSeconds: 4,
      title: "First",
      description: "On the first Clip.",
    });
    await addOverlay(video.id, 1, {
      at: 1,
      durationInSeconds: 3,
      title: "Second",
      description: "On the second Clip.",
    });

    await run(exportVideo(video.id));

    const [first, second] = compositeRuns[0]!.overlays;
    // The first Clip runs 0→10s, so its own offsets are the timeline's.
    expect(first!.startInSeconds).toBe(2);
    expect(first!.endInSeconds).toBe(6);
    // The second Clip starts where the first ends — 10s of source, no Pause.
    expect(second!.startInSeconds).toBe(11);
    expect(second!.endInSeconds).toBe(14);
  });

  it("counts a long Pause on a preceding Clip", async () => {
    const { video, run, compositeRuns } = await setup();

    const videoClips = await testDb
      .select({ id: clipsTable.id })
      .from(clipsTable)
      .where(eq(clipsTable.videoId, video.id))
      .orderBy(asc(clipsTable.order));
    await testDb
      .update(clipsTable)
      .set({ pauseType: "long" })
      .where(eq(clipsTable.id, videoClips[0]!.id));

    await addOverlay(video.id, 1, {
      at: 0,
      durationInSeconds: 2,
      title: "After the pause",
      description: "The Pause is part of the timeline.",
    });

    await run(exportVideo(video.id));

    expect(compositeRuns[0]!.overlays[0]!.startInSeconds).toBe(
      10 + LONG_PAUSE_DURATION_IN_SECONDS
    );
  });

  it("keeps a long card on screen across the next Clip, cut at the end", async () => {
    const { video, run, compositeRuns, cardRenderRequests } = await setup();

    await addOverlay(video.id, 0, {
      at: 9,
      durationInSeconds: 600,
      title: "Long-lived",
      description: "Outlives its anchor Clip by a mile.",
    });

    await run(exportVideo(video.id));

    const placed = compositeRuns[0]!.overlays[0]!;
    expect(placed.startInSeconds).toBe(9);
    // Two Clips of 10s, plus the final-video padding on the last one.
    expect(placed.endInSeconds).toBeCloseTo(20.42, 5);
    // What is SHOWN is cut; what is RENDERED is not, so the cached render is
    // the same file wherever else this card appears.
    expect(cardRenderRequests[0]!.content.durationInSeconds).toBe(600);
  });

  it("addresses each render by its content, under the Course", async () => {
    const { course, video, run, cardRenderRequests } = await setup();

    const content = {
      title: "Monomorphism",
      description: "Never collapses two inputs into one output.",
      durationInSeconds: 4,
    };
    await addOverlay(video.id, 0, { at: 2, ...content });

    await run(exportVideo(video.id));

    expect(cardRenderRequests[0]!.courseId).toBe(course.id);
    expect(cardRenderRequests[0]!.renderPath).toContain(
      `${course.id}-${computeDefinitionCardContentHash(content)}.mov`
    );
  });

  it("skips the pass entirely for a Video with no Overlays", async () => {
    const { video, run, cardRenderRequests, compositeRuns } = await setup();

    const targetPath = await run(exportVideo(video.id));

    expect(cardRenderRequests).toEqual([]);
    expect(compositeRuns).toEqual([]);
    // The exported bytes are exactly what the renderer wrote — the compositing
    // pass never touched them.
    expect(fs.readFileSync(targetPath, "utf-8")).toBe(DEFAULT_RENDERED_BYTES);
  });

  it("changes the exported bytes once a card is on the Video", async () => {
    const { video, run } = await setup();

    await addOverlay(video.id, 0, {
      at: 2,
      durationInSeconds: 4,
      title: "Monomorphism",
      description: "Never collapses two inputs into one output.",
    });

    const targetPath = await run(exportVideo(video.id));

    expect(fs.readFileSync(targetPath, "utf-8")).toBe(
      `${DEFAULT_RENDERED_BYTES}${COMPOSITED_BYTES_MARKER}`
    );
  });

  it("re-exports to a new address when a card's text is edited", async () => {
    const { video, run, compositeRuns } = await setup();

    await addOverlay(video.id, 0, {
      at: 2,
      durationInSeconds: 4,
      title: "Monomorphism",
      description: "Never collapses two inputs into one output.",
    });
    const firstPath = await run(exportVideo(video.id));

    await testDb
      .update(overlaysTable)
      .set({ description: "An injective function, in other words." });

    const secondPath = await run(exportVideo(video.id));

    // A different address — the Export Hash saw the edit — and a second
    // composite, so the new file really was rendered rather than reused.
    expect(secondPath).not.toBe(firstPath);
    expect(compositeRuns).toHaveLength(2);
    expect(compositeRuns[1]!.overlays[0]!.startInSeconds).toBe(2);
    expect(fs.existsSync(secondPath)).toBe(true);
  });
});
