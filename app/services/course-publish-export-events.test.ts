import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  runObservedExportLoop,
  type PublishDetailEvent,
} from "@/services/course-publish-export-events";

const video = (id: string, durationSeconds: number) => ({
  id,
  title: `01-intro/01.01-welcome/${id}`,
  durationSeconds,
});

/** Run the loop over `unexportedVideos`, recording every emitted event and the
 *  order in which the exports were actually begun. */
const runLoop = async (
  unexportedVideos: Array<{
    id: string;
    title: string;
    durationSeconds: number;
  }>
) => {
  const events: PublishDetailEvent[] = [];
  const startedVideoIds: string[] = [];

  const result = await Effect.runPromise(
    runObservedExportLoop({
      unexportedVideos,
      exportVideo: (videoId) =>
        Effect.sync(() => {
          startedVideoIds.push(videoId);
        }),
      onDetailEvent: (e) => events.push(e),
    })
  );

  return { events, startedVideoIds, result };
};

describe("runObservedExportLoop", () => {
  describe("queue order", () => {
    it("begins the longest videos first", async () => {
      const { startedVideoIds } = await runLoop([
        video("short", 30),
        video("longest", 900),
        video("medium", 120),
      ]);

      expect(startedVideoIds).toEqual(["longest", "medium", "short"]);
    });

    it("announces the queue longest-first too", async () => {
      const { events } = await runLoop([
        video("short", 30),
        video("longest", 900),
        video("medium", 120),
      ]);

      const videosEvent = events.find((e) => e.event === "videos");
      expect(videosEvent?.data).toEqual({
        videos: [
          { id: "longest", title: "01-intro/01.01-welcome/longest" },
          { id: "medium", title: "01-intro/01.01-welcome/medium" },
          { id: "short", title: "01-intro/01.01-welcome/short" },
        ],
      });
    });

    it("queues every video before starting any of them", async () => {
      const { events } = await runLoop([
        video("short", 30),
        video("longest", 900),
      ]);

      const queuedIds = events
        .filter((e) => e.event === "stage" && e.data.stage === "queued")
        .map((e) => (e.data as { videoId: string }).videoId);
      expect(queuedIds).toEqual(["longest", "short"]);
    });

    it("keeps the walk order for videos of equal length", async () => {
      const { startedVideoIds } = await runLoop([
        video("first", 60),
        video("second", 60),
        video("third", 60),
      ]);

      expect(startedVideoIds).toEqual(["first", "second", "third"]);
    });
  });

  it("emits complete per video and reports no failures", async () => {
    const { events, result } = await runLoop([video("only", 10)]);

    expect(events.filter((e) => e.event === "complete")).toEqual([
      { event: "complete", data: { videoId: "only" } },
    ]);
    expect(result.failedVideoIds).toEqual([]);
  });

  it("collects the ids of videos whose export keeps failing", async () => {
    const events: PublishDetailEvent[] = [];
    const result = await Effect.runPromise(
      runObservedExportLoop({
        unexportedVideos: [video("good", 10), video("bad", 20)],
        exportVideo: (videoId) =>
          videoId === "bad"
            ? Effect.fail({ message: "ffmpeg exploded" })
            : Effect.succeed(undefined),
        onDetailEvent: (e) => events.push(e),
      })
    );

    expect(result.failedVideoIds).toEqual(["bad"]);
    expect(events).toContainEqual({
      event: "error",
      data: { videoId: "bad", message: "ffmpeg exploded" },
    });
  });
});
