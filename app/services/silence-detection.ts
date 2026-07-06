import { Effect } from "effect";
import type { FFmpegCommandsService } from "./ffmpeg-commands";
import {
  SILENCE_THRESHOLD_DB,
  MINIMUM_CLIP_LENGTH_SECONDS,
  silenceLengthToSeconds,
  DEFAULT_SILENCE_LENGTH,
  type SilenceLength,
} from "@/silence-detection-constants";

const AUTO_EDITED_START_PADDING = 0; // frames
const AUTO_EDITED_END_PADDING = 0.08; // frames

interface SpeakingClip {
  startFrame: number;
  endFrame: number;
  startTime: number;
  endTime: number;
  durationInFrames: number;
}

/**
 * Pure function that parses ffmpeg silencedetect output into speaking clip boundaries.
 * No side effects — takes raw ffmpeg stdout and returns clip boundaries.
 */
export function getClipsOfSpeakingFromFFmpeg(
  rawOutput: string,
  opts: {
    startPadding: number;
    endPadding: number;
    fps: number;
  }
): SpeakingClip[] {
  const { startPadding, endPadding, fps } = opts;

  // Parse silence periods from ffmpeg output
  const silencePeriods: { start: number; end: number }[] = [];
  const lines = rawOutput.split("\n");

  let currentSilenceStart: number | null = null;

  for (const line of lines) {
    if (!line.includes("[silencedetect @")) continue;

    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);

    if (startMatch) {
      currentSilenceStart = Number(startMatch[1]);
    }

    if (endMatch && currentSilenceStart !== null) {
      silencePeriods.push({
        start: currentSilenceStart,
        end: Number(endMatch[1]),
      });
      currentSilenceStart = null;
    }
  }

  if (silencePeriods.length === 0) {
    return [];
  }

  // Derive speaking clips as gaps between silence periods
  const speakingClips: SpeakingClip[] = [];

  for (let i = 0; i < silencePeriods.length; i++) {
    const silenceEnd = silencePeriods[i]!.end;
    const nextSilenceStart =
      i + 1 < silencePeriods.length ? silencePeriods[i + 1]!.start : null;

    if (nextSilenceStart === null) break;

    const clipStartTime = silenceEnd;
    const clipEndTime = nextSilenceStart;
    const clipDuration = clipEndTime - clipStartTime;

    // Skip clips shorter than minimum
    if (clipDuration < MINIMUM_CLIP_LENGTH_SECONDS) continue;

    const startFrame = Math.round(clipStartTime * fps) - startPadding;
    const endFrame = Math.round(clipEndTime * fps) + endPadding;

    speakingClips.push({
      startFrame: Math.max(0, startFrame),
      endFrame,
      startTime: Math.max(0, startFrame / fps),
      endTime: endFrame / fps,
      durationInFrames: endFrame - Math.max(0, startFrame),
    });
  }

  return speakingClips;
}

/**
 * Runs ffmpeg silence detection and parses the output into clip boundaries.
 * Takes an FFmpegCommandsService instance directly to avoid leaking Effect requirements.
 */
export function findSilenceInVideo(
  ffmpeg: FFmpegCommandsService,
  inputVideo: string,
  opts?: { startTime?: number; silenceLength?: SilenceLength }
) {
  return Effect.gen(function* () {
    const fps = yield* ffmpeg.getFPS(inputVideo);

    const rawOutput = yield* ffmpeg.detectSilence(inputVideo, {
      threshold: SILENCE_THRESHOLD_DB,
      silenceDuration: silenceLengthToSeconds(
        opts?.silenceLength ?? DEFAULT_SILENCE_LENGTH
      ),
      startTime: opts?.startTime,
    });

    const speakingClips = getClipsOfSpeakingFromFFmpeg(rawOutput, {
      startPadding: Math.round(AUTO_EDITED_START_PADDING * fps),
      endPadding: Math.round(AUTO_EDITED_END_PADDING * fps),
      fps,
    });

    // Add back the startTime offset so timestamps are absolute file positions,
    // not relative to the ffmpeg seek point (-ss flag)
    const startTimeAdjustment = opts?.startTime ?? 0;

    // Convert frame-based durations to seconds (rounded to 2dp)
    const clips = speakingClips.map((clip) => {
      const startTime =
        Math.round(clip.startTime * 100) / 100 + startTimeAdjustment;
      const endTime =
        Math.round(clip.endTime * 100) / 100 + startTimeAdjustment;

      return {
        inputVideo,
        startTime,
        endTime,
      };
    });

    return { clips };
  });
}
