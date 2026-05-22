import { describe, expect, it } from "vitest";
import { ConfigProvider, Data, Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { batchExportProgram } from "@/services/batch-export.server";

class ExportFailedError extends Data.TaggedError("ExportFailedError")<{
  message: string;
}> {}

const makeVersion = (
  sections: Array<{
    path: string;
    lessons: Array<{
      path: string;
      videos: Array<{
        id: string;
        path: string;
        clips: Array<{
          videoFilename: string;
          sourceStartTime: number;
          sourceEndTime: number;
          beatType: string;
        }>;
      }>;
    }>;
  }>
) => ({
  id: "version-1",
  name: "v1",
  repoId: "repo-1",
  repo: { id: "repo-1", name: "test-repo", localPath: "/repo" },
  sections,
});

const makeTestLayer = (opts: {
  version?: ReturnType<typeof makeVersion>;
  existingFiles?: string[];
  exportBehavior?: (
    videoId: string,
    onStageChange?: (stage: "concatenating-clips" | "normalizing-audio") => void
  ) => Effect.Effect<void, ExportFailedError>;
}) => {
  const dbLayer = Layer.succeed(VersionOperationsService, {
    getVersionWithSections: (...args: unknown[]) => {
      if (!opts.version) {
        return Effect.fail(
          new (Data.TaggedError("NotFoundError") as any)({
            type: "getVersionWithSections",
            params: { versionId: args[0] },
          })
        );
      }
      return Effect.succeed(opts.version);
    },
  } as any);

  const videoProcessingLayer = Layer.succeed(VideoProcessingService, {
    exportVideoClips: (exportOpts: any) => {
      if (opts.exportBehavior) {
        return opts.exportBehavior(
          exportOpts.videoId,
          exportOpts.onStageChange
        );
      }
      exportOpts.onStageChange?.("concatenating-clips");
      exportOpts.onStageChange?.("normalizing-audio");
      return Effect.void;
    },
  } as any);

  const fsLayer = FileSystem.layerNoop({
    exists: (filePath) =>
      Effect.succeed((opts.existingFiles ?? []).includes(filePath as string)),
  });

  const configLayer = Layer.setConfigProvider(
    ConfigProvider.fromMap(new Map([["FINISHED_VIDEOS_DIRECTORY", "/output"]]))
  );

  return Layer.mergeAll(dbLayer, videoProcessingLayer, fsLayer, configLayer);
};

const runProgram = (
  versionId: string,
  layer: ReturnType<typeof makeTestLayer>
) => {
  const events: Array<{ event: string; data: unknown }> = [];
  const sendEvent = (event: string, data: unknown) => {
    events.push({ event, data });
  };

  const effect = batchExportProgram(versionId, sendEvent).pipe(
    Effect.provide(layer)
  );
  return Effect.runPromise(effect as Effect.Effect<void>).then(() => events);
};

describe("batch export SSE endpoint", () => {
  it("sends videos event listing unexported videos", async () => {
    const layer = makeTestLayer({
      version: makeVersion([
        {
          path: "intro",
          lessons: [
            {
              path: "lesson-1",
              videos: [
                {
                  id: "video-1",
                  path: "getting-started",
                  clips: [
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 10,
                      beatType: "none",
                    },
                  ],
                },
                {
                  id: "video-2",
                  path: "setup",
                  clips: [
                    {
                      videoFilename: "rec2.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 5,
                      beatType: "none",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      existingFiles: [],
    });

    const events = await runProgram("version-1", layer);

    expect(events[0]).toEqual({
      event: "videos",
      data: {
        videos: [
          { id: "video-1", title: "intro/lesson-1/getting-started" },
          { id: "video-2", title: "intro/lesson-1/setup" },
        ],
      },
    });
  });

  it("sends queued stage for all videos, then stage changes and complete", async () => {
    const layer = makeTestLayer({
      version: makeVersion([
        {
          path: "intro",
          lessons: [
            {
              path: "lesson-1",
              videos: [
                {
                  id: "video-1",
                  path: "vid",
                  clips: [
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 10,
                      beatType: "none",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      existingFiles: [],
    });

    const events = await runProgram("version-1", layer);

    // videos → queued → concatenating-clips → normalizing-audio → complete
    expect(events).toEqual([
      {
        event: "videos",
        data: { videos: [{ id: "video-1", title: "intro/lesson-1/vid" }] },
      },
      {
        event: "stage",
        data: { videoId: "video-1", stage: "queued" },
      },
      {
        event: "stage",
        data: { videoId: "video-1", stage: "concatenating-clips" },
      },
      {
        event: "stage",
        data: { videoId: "video-1", stage: "normalizing-audio" },
      },
      {
        event: "complete",
        data: { videoId: "video-1" },
      },
    ]);
  });

  it("skips already-exported videos", async () => {
    const layer = makeTestLayer({
      version: makeVersion([
        {
          path: "intro",
          lessons: [
            {
              path: "lesson-1",
              videos: [
                {
                  id: "video-1",
                  path: "exported",
                  clips: [
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 10,
                      beatType: "none",
                    },
                  ],
                },
                {
                  id: "video-2",
                  path: "not-exported",
                  clips: [
                    {
                      videoFilename: "rec2.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 5,
                      beatType: "none",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      existingFiles: ["/output/video-1.mp4"],
    });

    const events = await runProgram("version-1", layer);

    expect(events[0]).toEqual({
      event: "videos",
      data: {
        videos: [{ id: "video-2", title: "intro/lesson-1/not-exported" }],
      },
    });
  });

  it("skips videos with no clips", async () => {
    const layer = makeTestLayer({
      version: makeVersion([
        {
          path: "intro",
          lessons: [
            {
              path: "lesson-1",
              videos: [
                {
                  id: "video-1",
                  path: "no-clips",
                  clips: [],
                },
                {
                  id: "video-2",
                  path: "has-clips",
                  clips: [
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 5,
                      beatType: "none",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      existingFiles: [],
    });

    const events = await runProgram("version-1", layer);

    expect(events[0]).toEqual({
      event: "videos",
      data: {
        videos: [{ id: "video-2", title: "intro/lesson-1/has-clips" }],
      },
    });
  });

  it("sends empty videos event when all videos are exported", async () => {
    const layer = makeTestLayer({
      version: makeVersion([
        {
          path: "intro",
          lessons: [
            {
              path: "lesson-1",
              videos: [
                {
                  id: "video-1",
                  path: "vid",
                  clips: [
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 10,
                      beatType: "none",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      existingFiles: ["/output/video-1.mp4"],
    });

    const events = await runProgram("version-1", layer);

    expect(events).toEqual([{ event: "videos", data: { videos: [] } }]);
  });

  it("sends error for failed video after retries, without affecting others", async () => {
    let video1Attempts = 0;

    const layer = makeTestLayer({
      version: makeVersion([
        {
          path: "intro",
          lessons: [
            {
              path: "lesson-1",
              videos: [
                {
                  id: "video-1",
                  path: "will-fail",
                  clips: [
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 10,
                      beatType: "none",
                    },
                  ],
                },
                {
                  id: "video-2",
                  path: "will-succeed",
                  clips: [
                    {
                      videoFilename: "rec2.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 5,
                      beatType: "none",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      existingFiles: [],
      exportBehavior: (videoId, onStageChange) => {
        if (videoId === "video-1") {
          return Effect.suspend(() => {
            video1Attempts++;
            return Effect.fail(
              new ExportFailedError({ message: "FFmpeg crashed" })
            );
          });
        }
        onStageChange?.("concatenating-clips");
        onStageChange?.("normalizing-audio");
        return Effect.void;
      },
    });

    const events = await runProgram("version-1", layer);

    // video-1 should have error event
    const errorEvents = events.filter((e) => e.event === "error");
    expect(errorEvents).toEqual([
      {
        event: "error",
        data: { videoId: "video-1", message: "FFmpeg crashed" },
      },
    ]);

    // video-2 should complete successfully
    const completeEvents = events.filter((e) => e.event === "complete");
    expect(completeEvents).toEqual([
      { event: "complete", data: { videoId: "video-2" } },
    ]);

    // video-1 should have been retried 3 times (initial + 2 retries)
    expect(video1Attempts).toBe(3);
  });

  it("sends version not found error for invalid versionId", async () => {
    const layer = makeTestLayer({
      version: undefined,
    });

    const events = await runProgram("nonexistent", layer);

    expect(events).toEqual([
      {
        event: "error",
        data: { videoId: null, message: "Version not found" },
      },
    ]);
  });

  it("handles multiple sections and lessons", async () => {
    const layer = makeTestLayer({
      version: makeVersion([
        {
          path: "section-a",
          lessons: [
            {
              path: "lesson-1",
              videos: [
                {
                  id: "video-1",
                  path: "vid-1",
                  clips: [
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 10,
                      beatType: "none",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          path: "section-b",
          lessons: [
            {
              path: "lesson-2",
              videos: [
                {
                  id: "video-2",
                  path: "vid-2",
                  clips: [
                    {
                      videoFilename: "rec2.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 5,
                      beatType: "long",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      existingFiles: [],
    });

    const events = await runProgram("version-1", layer);

    expect(events[0]).toEqual({
      event: "videos",
      data: {
        videos: [
          { id: "video-1", title: "section-a/lesson-1/vid-1" },
          { id: "video-2", title: "section-b/lesson-2/vid-2" },
        ],
      },
    });

    // Both should get queued then complete
    const completeEvents = events.filter((e) => e.event === "complete");
    expect(completeEvents).toHaveLength(2);
  });
});
