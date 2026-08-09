/**
 * PROTOTYPE service backing `app/routes/prototype.audio-proofread.tsx`.
 *
 * Purpose: sanity-check whether ffmpeg silence-detection can flag the kind of
 * editing problems a human catches by ear in a rendered lesson — a pause that
 * runs long, a brief audio dropout, a click/level-jump right at a clip join —
 * so Matt can eyeball the results before anyone invests in a real feature.
 * No auto-fix, no publish-gating: this only produces a flat report.
 *
 * All the threshold constants below are rough first guesses, not tuned
 * against real footage — see the PR description for how to retune them.
 *
 * Deliberately ignores the render-time padding `course-publish-service.ts` /
 * `batch-export.server.ts` add (`LONG_PAUSE_DURATION` = 0.18s between a
 * `pauseType: "long"` clip and the next, `FINAL_VIDEO_PADDING` = 0.42s on the
 * very last clip). Matt's feedback timestamps are eyeballed by ear ("1:30"),
 * not frame-exact, so a few hundred ms of drift near a `long` pause or at the
 * very end of the video is acceptable noise for a throwaway prototype.
 */

import { Effect } from "effect";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { VideoOperationsService } from "./db-video-operations.server";
import {
  type ProofreadOptions,
  type ProofreadClip,
  sanitizeProofreadOptions,
  computeClipVideoOffsets,
  classifyPerClipSpans,
  computeJoinWindow,
  classifyBoundarySpan,
  consecutivePairs,
  round2,
} from "./clip-audio-proofread-shared";

// Re-exported so server-side code (this file's own service, tests, etc.) can
// still import everything from one place. Client-rendered code (the route's
// component) must import the client-safe subset directly from
// `./clip-audio-proofread-shared` instead — see that file's doc comment.
export * from "./clip-audio-proofread-shared";

// ─── Service ─────────────────────────────────────────────────────────────

export class ClipAudioProofreadService extends Effect.Service<ClipAudioProofreadService>()(
  "ClipAudioProofreadService",
  {
    effect: Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const ffmpeg = yield* FFmpegCommandsService;

      const proofreadPerClipSpans = Effect.fn("proofreadPerClipSpans")(
        function* (
          clip: ProofreadClip,
          videoStartSeconds: number,
          options: ProofreadOptions
        ) {
          const [longRaw, shortRaw] = yield* Effect.all(
            [
              ffmpeg.detectSilence(clip.videoFilename, {
                threshold: options.silenceThresholdDb,
                silenceDuration: options.longPauseMinSeconds,
                startTime: clip.sourceStartTime,
              }),
              ffmpeg.detectSilence(clip.videoFilename, {
                threshold: options.silenceThresholdDb,
                silenceDuration: options.shortCutoutMinSeconds,
                startTime: clip.sourceStartTime,
              }),
            ],
            { concurrency: 2 }
          );

          return classifyPerClipSpans(
            longRaw,
            shortRaw,
            clip,
            videoStartSeconds,
            options
          );
        }
      );

      const proofreadBoundary = Effect.fn("proofreadBoundary")(function* (
        clipA: ProofreadClip,
        clipB: ProofreadClip,
        clipBVideoStartSeconds: number,
        options: ProofreadOptions
      ) {
        const { segmentA, segmentB, joinPointSeconds } = computeJoinWindow(
          clipA,
          clipB,
          options.joinWindowSeconds
        );

        if (segmentA.durationSeconds <= 0 || segmentB.durationSeconds <= 0) {
          return [];
        }

        const rawOutput = yield* ffmpeg.detectSilenceAcrossJoin(
          {
            file: segmentA.file,
            startTime: segmentA.seekSeconds,
            duration: segmentA.durationSeconds,
          },
          {
            file: segmentB.file,
            startTime: segmentB.seekSeconds,
            duration: segmentB.durationSeconds,
          },
          {
            threshold: options.silenceThresholdDb,
            silenceDuration: options.shortCutoutMinSeconds,
          }
        );

        return classifyBoundarySpan(
          rawOutput,
          joinPointSeconds,
          clipB,
          clipBVideoStartSeconds,
          options.joinToleranceSeconds
        );
      });

      const proofreadVideo = Effect.fn("proofreadVideo")(function* (
        videoId: string,
        overrides?: Partial<Record<keyof ProofreadOptions, unknown>> | null
      ) {
        const options = sanitizeProofreadOptions(overrides);

        const video = yield* videoOps.getVideoWithClipsById(videoId);
        const clips: ProofreadClip[] = video.clips.map((c) => ({
          id: c.id,
          videoFilename: c.videoFilename,
          sourceStartTime: c.sourceStartTime,
          sourceEndTime: c.sourceEndTime,
        }));

        const offsets = computeClipVideoOffsets(clips);
        const videoStartByClipId = new Map(
          offsets.map((o) => [o.clipId, o.videoStartSeconds])
        );
        const totalDurationSeconds = offsets.reduce(
          (acc, o) => acc + o.durationSeconds,
          0
        );

        const perClipSpans = yield* Effect.forEach(
          clips,
          (clip) =>
            proofreadPerClipSpans(
              clip,
              videoStartByClipId.get(clip.id)!,
              options
            ),
          { concurrency: 4 }
        );

        const boundarySpans = yield* Effect.forEach(
          consecutivePairs(clips),
          ([clipA, clipB]) =>
            proofreadBoundary(
              clipA,
              clipB,
              videoStartByClipId.get(clipB.id)!,
              options
            ),
          { concurrency: 4 }
        );

        const spans = [...perClipSpans.flat(), ...boundarySpans.flat()].sort(
          (a, b) => a.videoTimestampSeconds - b.videoTimestampSeconds
        );

        return {
          videoId: video.id,
          title: video.title,
          totalDurationSeconds: round2(totalDurationSeconds),
          options,
          spans,
        };
      });

      return { proofreadVideo };
    }),
    dependencies: [
      VideoOperationsService.Default,
      FFmpegCommandsService.Default,
    ],
  }
) {}
