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
import type { BulletPanelBullet } from "@/features/videos/bullet-panel";
import type { OverlayKind } from "@/features/videos/overlay-kind";
import { computeOverlayContentHash } from "./overlay-render-cache";
import { buildOverlayCompositeFilterGraph } from "./overlay-compositing";

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

/** Give a Video's `index`-th Clip an Overlay. Defaults to a Definition Card. */
const addOverlay = async (
  videoId: string,
  clipIndex: number,
  overlay: {
    at: number;
    durationInSeconds: number;
    title: string;
    description?: string;
    kind?: OverlayKind;
    bullets?: BulletPanelBullet[];
    disableEnterAnimation?: boolean;
    disableExitAnimation?: boolean;
  }
) => {
  const videoClips = await testDb
    .select({ id: clipsTable.id })
    .from(clipsTable)
    .where(eq(clipsTable.videoId, videoId))
    .orderBy(asc(clipsTable.order));
  await testDb.insert(overlaysTable).values({
    clipId: videoClips[clipIndex]!.id,
    ...overlay,
    // A Bullet Panel has no description; the column is NOT NULL, so it holds
    // the empty string exactly as `cvm overlay add --kind bulletPanel` writes.
    description: overlay.description ?? "",
  });
};

/** Give a Video's `index`-th Clip an Overlay carrying a Bullet Panel. */
const addBulletPanel = (
  videoId: string,
  clipIndex: number,
  overlay: {
    at: number;
    durationInSeconds: number;
    title: string;
    bullets: BulletPanelBullet[];
    disableEnterAnimation?: boolean;
    disableExitAnimation?: boolean;
  }
) => addOverlay(videoId, clipIndex, { kind: "bulletPanel", ...overlay });

const BULLETS: BulletPanelBullet[] = [
  { icon: "circle-check", text: "Runs on the server", revealAt: 0.5 },
  { icon: "database", text: "Reaches the database", revealAt: 2 },
];

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
      `${course.id}-${computeOverlayContentHash({ kind: "definitionCard", ...content })}.mov`
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

  describe("when a stage fails, the Video's log says why", () => {
    /**
     * The export's own error names the Video and nothing else, on purpose —
     * one failed card and one failed ffmpeg pass are both just "this Video did
     * not export". That makes the Video's log the only place the actual cause
     * can survive, so these tests hold it to writing one.
     */
    const cardRenderFailure = new Error(
      "The overlay renderer exited with code 1: Chromium could not start"
    );

    it("records the cause of a failed card render, unwrapped", async () => {
      const { video, run, videoLog } = await setup({
        failCardRenderWith: cardRenderFailure,
      });

      await addOverlay(video.id, 0, {
        at: 2,
        durationInSeconds: 4,
        title: "Monomorphism",
        description: "Never collapses two inputs into one output.",
      });

      await expect(run(exportVideo(video.id))).rejects.toThrow();

      const failures = videoLog.ofType("export-stage-failed");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.videoId).toBe(video.id);
      // Which stage the export never got past.
      expect(failures[0]!.stage).toBe("export:render-overlays");
      // The detail the export's own ExportError throws away.
      expect(failures[0]!.cause).toContain("Chromium could not start");
    });

    it("writes the failure to the log of the Video that failed", async () => {
      const { videos, run, videoLog } = await setup({
        videoCount: 2,
        failCardRenderWith: cardRenderFailure,
      });

      await addOverlay(videos[1]!.id, 0, {
        at: 1,
        durationInSeconds: 3,
        title: "Epimorphism",
        description: "Cancels on the right.",
      });

      await expect(run(exportVideo(videos[1]!.id))).rejects.toThrow();

      expect(videoLog.lines.map((line) => line.videoId)).toEqual([
        videos[1]!.id,
      ]);
    });

    it("stays quiet when every stage succeeds", async () => {
      const { video, run, videoLog } = await setup();

      await addOverlay(video.id, 0, {
        at: 2,
        durationInSeconds: 4,
        title: "Monomorphism",
        description: "Never collapses two inputs into one output.",
      });
      await run(exportVideo(video.id));

      expect(videoLog.ofType("export-stage-failed")).toEqual([]);
    });
  });
});

/**
 * Bullet Panels in a real course export — the whole feature end to end.
 *
 * The point of these is that ONE export pass produces both halves of a Bullet
 * Panel: the rendered panel (its own `.mov`, addressed by its bullets) and the
 * camera move under it (a `crop` node in the same filtergraph). Everything
 * between the two fakes is real — the Overlay rows, the Export Hash, the
 * timeline placement, the content address, and the filtergraph itself.
 */
describe("Bullet Panels in a course export", () => {
  it("renders the panel and pans the camera in one pass, gated to one window", async () => {
    const { video, run, cardRenderRequests, compositeRuns } = await setup();

    // On the second Clip, which starts at 10s on the flattened timeline.
    await addBulletPanel(video.id, 1, {
      at: 1,
      durationInSeconds: 6,
      title: "What a Server Component does",
      bullets: BULLETS,
    });

    await run(exportVideo(video.id));

    // ONE render, ONE composite pass — the panel and the camera are not two
    // trips through ffmpeg.
    expect(cardRenderRequests).toHaveLength(1);
    expect(compositeRuns).toHaveLength(1);

    const placed = compositeRuns[0]!.overlays[0]!;
    expect(placed.startInSeconds).toBe(11);
    expect(placed.endInSeconds).toBe(17);

    const graph = buildOverlayCompositeFilterGraph(compositeRuns[0]!.overlays)!;
    // The camera move: a time-varying crop on the footage itself...
    expect(graph).toContain("crop=w=");
    expect(graph).toContain("enable='between(t,11.000000,17.000000)'");
    // ...and the panel drawn on top of it, over the very same window.
    expect(graph).toContain("[1:v]setpts=PTS-STARTPTS+11.000/TB[ovl0]");
    expect(graph).toContain(
      "overlay=x=0:y=0:format=auto:eof_action=pass:repeatlast=0" +
        ":enable='between(t,11.000,17.000)'"
    );
    // The crop runs BEFORE the graphic chain: the footage slides out from
    // under a panel that is itself standing still.
    expect(graph.indexOf("crop=w=")).toBeLessThan(graph.indexOf("overlay=x=0"));
  });

  it("asks the cache for the panel's own content, bullets and all", async () => {
    const { course, video, run, cardRenderRequests } = await setup();

    await addBulletPanel(video.id, 0, {
      at: 2,
      durationInSeconds: 6,
      title: "What a Server Component does",
      bullets: BULLETS,
    });

    await run(exportVideo(video.id));

    const content = {
      kind: "bulletPanel",
      title: "What a Server Component does",
      bullets: BULLETS,
      durationInSeconds: 6,
      disableEnterAnimation: false,
      disableExitAnimation: false,
    } as const;

    expect(cardRenderRequests[0]!.content).toEqual(content);
    expect(cardRenderRequests[0]!.courseId).toBe(course.id);
    expect(cardRenderRequests[0]!.renderPath).toContain(
      `${course.id}-${computeOverlayContentHash(content)}.mov`
    );
  });

  it("gives a Definition Card and a Bullet Panel of the same title different renders", async () => {
    const { video, run, cardRenderRequests } = await setup();

    await addOverlay(video.id, 0, {
      at: 1,
      durationInSeconds: 4,
      title: "Server Components",
      description: "",
    });
    await addBulletPanel(video.id, 1, {
      at: 1,
      durationInSeconds: 4,
      title: "Server Components",
      bullets: [],
    });

    await run(exportVideo(video.id));

    expect(cardRenderRequests[0]!.renderPath).not.toBe(
      cardRenderRequests[1]!.renderPath
    );
  });

  describe("editing a panel invalidates both caches", () => {
    /**
     * Two caches govern a re-export and BOTH have to notice an edit: the
     * whole-video Export Hash (which names the `.mp4` and decides whether
     * ffmpeg runs at all) and the Overlay Render Cache's content address
     * (which names the panel's `.mov` and decides whether Chromium runs).
     * A test that watched only one would pass while the other served stale.
     */
    /**
     * Export once, and report BOTH addresses it landed on: the `.mp4` the
     * Export Hash named, and the `.mov` the Overlay Render Cache named. The
     * render address is read from the LAST request the fake recorded — a
     * second export that reuses its cached `.mp4` never asks for a render at
     * all, and "the address did not move" is exactly what that means.
     */
    const exportAddresses = async (
      videoId: string,
      run: (effect: ReturnType<typeof exportVideo>) => Promise<string>,
      cardRenderRequests: ReadonlyArray<{ renderPath: string }>
    ) => ({
      exportPath: await run(exportVideo(videoId)),
      renderPath: cardRenderRequests.at(-1)!.renderPath,
    });

    const editCases: ReadonlyArray<
      [string, Partial<{ bullets: BulletPanelBullet[]; title: string }>]
    > = [
      [
        "a bullet's text",
        {
          bullets: [{ ...BULLETS[0]!, text: "Runs on the edge" }, BULLETS[1]!],
        },
      ],
      [
        "a bullet's icon",
        { bullets: [{ ...BULLETS[0]!, icon: "server" }, BULLETS[1]!] },
      ],
      [
        "a bullet's revealAt",
        { bullets: [{ ...BULLETS[0]!, revealAt: 1.25 }, BULLETS[1]!] },
      ],
      ["the panel's heading", { title: "What a Server Component is" }],
    ];

    for (const [what, edit] of editCases) {
      it(`re-exports to a new address when ${what} is edited`, async () => {
        const { video, run, cardRenderRequests, compositeRuns } = await setup();

        await addBulletPanel(video.id, 0, {
          at: 2,
          durationInSeconds: 6,
          title: "What a Server Component does",
          bullets: BULLETS,
        });

        const first = await exportAddresses(video.id, run, cardRenderRequests);

        await testDb.update(overlaysTable).set(edit);

        const second = await exportAddresses(video.id, run, cardRenderRequests);

        // The Export Hash saw the edit: a new `.mp4` address...
        expect(second.exportPath).not.toBe(first.exportPath);
        // ...the Overlay Render Cache saw it too: a new `.mov` address...
        expect(second.renderPath).not.toBe(first.renderPath);
        // ...and the pass really ran again rather than reusing the old file.
        expect(compositeRuns).toHaveLength(2);
        expect(fs.existsSync(second.exportPath)).toBe(true);
      });
    }

    it("re-exports to a new address when an Animation Toggle is set", async () => {
      const { video, run, cardRenderRequests } = await setup();

      await addBulletPanel(video.id, 0, {
        at: 2,
        durationInSeconds: 6,
        title: "What a Server Component does",
        bullets: BULLETS,
      });

      const first = await exportAddresses(video.id, run, cardRenderRequests);

      await testDb.update(overlaysTable).set({ disableEnterAnimation: true });

      const second = await exportAddresses(video.id, run, cardRenderRequests);

      // A toggle cuts the camera AND the panel's own animation, so both the
      // composited video and the rendered panel are different bytes.
      expect(second.exportPath).not.toBe(first.exportPath);
      expect(second.renderPath).not.toBe(first.renderPath);
    });

    it("reuses both addresses when nothing about the panel changed", async () => {
      const { video, run, cardRenderRequests } = await setup();

      await addBulletPanel(video.id, 0, {
        at: 2,
        durationInSeconds: 6,
        title: "What a Server Component does",
        bullets: BULLETS,
      });

      const first = await exportAddresses(video.id, run, cardRenderRequests);
      const second = await exportAddresses(video.id, run, cardRenderRequests);

      expect(second.exportPath).toBe(first.exportPath);
      expect(second.renderPath).toBe(first.renderPath);
    });
  });
});
