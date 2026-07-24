import { Effect, Schedule } from "effect";

// The observable surface of a publish/batch-export run. Every emission is a
// member of this union, so a typo'd event name or a malformed payload fails
// typecheck instead of silently dropping on the SSE floor.
export type PublishDetailEvent =
  // The full list of Videos this run will export, titled section/lesson/title.
  | { event: "videos"; data: { videos: Array<{ id: string; title: string }> } }
  | {
      event: "stage";
      data: {
        videoId: string;
        stage: "queued" | "concatenating-clips" | "normalizing-audio";
      };
    }
  | { event: "complete"; data: { videoId: string } }
  | { event: "error"; data: { videoId: string; message: string } }
  // Real ffmpeg progress within an export stage: integer percent 0–99 that
  // resets when the stage changes (100 is signalled by `complete`).
  | {
      event: "video-progress";
      data: {
        videoId: string;
        stage: "concatenating-clips" | "normalizing-audio";
        percent: number;
      };
    }
  // Per-lesson upload percentage from the Dropbox commit.
  | { event: "progress"; data: { percentage: number } };

export type EmitPublishDetailEvent = (e: PublishDetailEvent) => void;

// The coarse publish lifecycle stages, in emission order.
export type PublishStage =
  | "validating"
  | "exporting"
  | "uploading"
  | "freezing"
  | "cloning"
  | "complete";

export const MAX_CONCURRENT_EXPORTS = 6;

export const extractErrorMessage = (e: unknown, fallback: string): string =>
  typeof e === "object" &&
  e !== null &&
  "message" in e &&
  typeof e.message === "string"
    ? e.message
    : fallback;

// The shared per-video export+emission loop behind both batchExport and
// publish: emit the `videos` list, pre-emit `queued` per Video, run the
// export with its ffmpeg stage wiring, retry twice per Video, emit
// `complete`/`error` per Video, and return the ids that still failed.
export const runObservedExportLoop = <A, E, R>(input: {
  unexportedVideos: Array<{ id: string; title: string }>;
  exportVideo: (
    videoId: string,
    onStage: (stage: "concatenating-clips" | "normalizing-audio") => void,
    onProgress: (info: {
      stage: "concatenating-clips" | "normalizing-audio";
      percent: number;
    }) => void
  ) => Effect.Effect<A, E, R>;
  onDetailEvent?: EmitPublishDetailEvent;
}): Effect.Effect<{ failedVideoIds: string[] }, never, R> =>
  Effect.gen(function* () {
    const { unexportedVideos, exportVideo, onDetailEvent } = input;

    onDetailEvent?.({
      event: "videos",
      data: {
        videos: unexportedVideos.map((v) => ({ id: v.id, title: v.title })),
      },
    });

    for (const video of unexportedVideos) {
      onDetailEvent?.({
        event: "stage",
        data: { videoId: video.id, stage: "queued" },
      });
    }

    const failedVideoIds: string[] = [];
    yield* Effect.forEach(
      unexportedVideos,
      (video) =>
        exportVideo(
          video.id,
          (stage) => {
            onDetailEvent?.({
              event: "stage",
              data: { videoId: video.id, stage },
            });
          },
          ({ stage, percent }) => {
            onDetailEvent?.({
              event: "video-progress",
              data: { videoId: video.id, stage, percent },
            });
          }
        ).pipe(
          Effect.retry(Schedule.recurs(2)),
          Effect.tap(() => {
            onDetailEvent?.({
              event: "complete",
              data: { videoId: video.id },
            });
          }),
          Effect.catchAll((e) =>
            Effect.sync(() => {
              onDetailEvent?.({
                event: "error",
                data: {
                  videoId: video.id,
                  message: extractErrorMessage(e, "Export failed unexpectedly"),
                },
              });
              failedVideoIds.push(video.id);
            })
          )
        ),
      { concurrency: MAX_CONCURRENT_EXPORTS }
    );

    return { failedVideoIds };
  });
