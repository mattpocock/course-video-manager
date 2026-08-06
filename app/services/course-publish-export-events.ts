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
  | { event: "progress"; data: { percentage: number } }
  // ── The Dropbox upload, one task per shipping Video ──────────────────────
  // Every Video this Publish ships, titled section/lesson/title. Unlike the
  // export `videos` roster above this is the WHOLE bundle: a Video a previous
  // run already exported does no encoding but still has to be uploaded, so it
  // still gets a task.
  | {
      event: "upload-videos";
      data: { videos: Array<{ id: string; title: string }> };
    }
  // This Video's bytes exist — its export settled, or it was already on disk —
  // and it is now waiting for a slot in the upload pool.
  | { event: "upload-queued"; data: { videoId: string } }
  // Bytes moving for one Video. Emitted at 0 the moment the upload pool picks
  // the Video up, so `totalBytes` (its size on disk) is known from the start
  // and a consumer can weight this Video against its siblings.
  | {
      event: "upload-video-progress";
      data: { videoId: string; uploadedBytes: number; totalBytes: number };
    }
  | { event: "upload-video-complete"; data: { videoId: string; bytes: number } }
  | { event: "upload-video-error"; data: { videoId: string; message: string } }
  // ── Reuse from the previously Published Bundle ───────────────────────────
  // The reuse plan, announced the moment it is known — before a frame is
  // encoded or a byte moves. These Videos already exist on Dropbox and will be
  // copied there server-side, so they never enter the byte-weighted
  // denominator: counting bytes that never cross the wire would make the
  // upload percentage meaningless.
  | {
      event: "upload-videos-reused";
      data: { videos: Array<{ id: string; bytes: number }> };
    }
  // One Video's copy has landed and its content hash matched its source. A
  // Video that fails to copy never reaches here — it emits an ordinary upload
  // task instead, because it has rejoined the upload queue.
  | { event: "upload-video-reused"; data: { videoId: string; bytes: number } };

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
//
// The queue runs in the order it is handed over — announced, queued, and
// started front to back — so the caller that builds the list decides which
// Videos begin first.
//
// `onVideoSettled` is the HANDOFF out of the export pool: it fires once a
// Video's export has finally succeeded or failed, and is what lets a
// downstream pool (the Dropbox upload pool) start on that one Video while its
// siblings are still encoding. It runs inside the fan-out, so it is reached as
// soon as that Video settles rather than when the loop as a whole finishes.
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
  onVideoSettled?: (result: {
    videoId: string;
    exported: boolean;
  }) => Effect.Effect<void>;
}): Effect.Effect<{ failedVideoIds: string[] }, never, R> =>
  Effect.gen(function* () {
    const { unexportedVideos, exportVideo, onDetailEvent, onVideoSettled } =
      input;

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

    // Suspended so the hand-off is only reached when the Video actually
    // settles, never while the fan-out is being described.
    const settle = (videoId: string, exported: boolean) =>
      Effect.suspend(
        () => onVideoSettled?.({ videoId, exported }) ?? Effect.void
      );

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
          Effect.matchEffect({
            onSuccess: () => settle(video.id, true),
            onFailure: (e) =>
              Effect.sync(() => {
                onDetailEvent?.({
                  event: "error",
                  data: {
                    videoId: video.id,
                    message: extractErrorMessage(
                      e,
                      "Export failed unexpectedly"
                    ),
                  },
                });
                failedVideoIds.push(video.id);
              }).pipe(Effect.andThen(settle(video.id, false))),
          })
        ),
      { concurrency: MAX_CONCURRENT_EXPORTS }
    );

    return { failedVideoIds };
  });
