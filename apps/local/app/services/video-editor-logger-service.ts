import { Effect } from "effect";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// ============================================================================
// Log Event Types
// ============================================================================

export type LogEvent =
  | {
      type: "clips-appended";
      videoId: string;
      insertionPoint: unknown;
      clips: { inputVideo: string; startTime: number; endTime: number }[];
      generatedOrders: string[];
    }
  | {
      type: "clips-archived";
      clipIds: string[];
    }
  | {
      type: "clips-unarchived";
      clipIds: string[];
    }
  | {
      type: "clips-updated";
      clips: {
        id: string;
        scene?: string;
        profile?: string;
        pauseType?: string;
      }[];
    }
  | {
      type: "pause-updated";
      clipId: string;
      pauseType: string;
    }
  | {
      type: "clip-text-updated";
      clipId: string;
    }
  | {
      type: "zoom-updated";
      clipId: string;
      zoomType: string;
    }
  | {
      type: "scene-override-updated";
      clipId: string;
      sceneOverride: string | null;
    }
  | {
      type: "mic-offset-updated";
      recordingSessionId: string;
      micOffsetMs: number;
    }
  | {
      type: "clip-reordered";
      clipId: string;
      direction: "up" | "down";
    }
  | {
      type: "chapter-created";
      sectionId: string;
      name: string;
      order: string;
    }
  | {
      type: "chapter-updated";
      chapterId: string;
      name: string;
    }
  | {
      type: "chapters-archived";
      chapterIds: string[];
    }
  | {
      type: "chapter-reordered";
      chapterId: string;
      direction: "up" | "down";
    }
  | {
      type: "effect-clip-created";
      clipId: string;
      text: string;
      scene: string;
      order: string;
    }
  | {
      type: "transcription-requested";
      clipIds: string[];
    }
  | {
      type: "transcription-completed";
      clipIds: string[];
    }
  | {
      type: "cli-output";
      command: string;
      stdout?: string;
      stderr?: string;
    }
  | {
      type: "video-exported";
      videoId: string;
    }
  | {
      /**
       * A stage of an export failed, and why.
       *
       * The ffmpeg passes write their own output here as `cli-output`, so a
       * failure inside one of them leaves a trail. A stage that fails BEFORE
       * ffmpeg is reached — a Definition Card that will not render, a missing
       * config key — leaves none, and the export's own error names only the
       * Video. This event is where that cause goes, in the same file, in
       * order, beside the passes that did run.
       */
      type: "export-stage-failed";
      videoId: string;
      /** Same naming as `cli-output`'s stage, e.g. `export:composite-overlays`. */
      stage: string;
      /** What the export reported to its caller. */
      message: string;
      /** The underlying failure, unwrapped — see `formatFailureCause`. */
      cause: string;
    }
  | {
      type: "video-created-from-selection";
      sourceVideoId: string;
      clipIds: string[];
      newVideoId: string;
    }
  | {
      type: "chapters-autofilled";
      count: number;
      titles: string[];
    };

// ============================================================================
// Service
// ============================================================================

const LOG_DIR = path.resolve(".data/logs");

export class VideoEditorLoggerService extends Effect.Service<VideoEditorLoggerService>()(
  "VideoEditorLoggerService",
  {
    effect: Effect.gen(function* () {
      const getLogPath = (videoId: string): string => {
        return path.join(LOG_DIR, `${videoId}.log`);
      };

      const log = Effect.fn("VideoEditorLoggerService.log")(function* (
        videoId: string,
        event: LogEvent
      ) {
        const logPath = getLogPath(videoId);

        mkdirSync(LOG_DIR, { recursive: true });

        const timestamp = new Date().toISOString();
        const line = `${timestamp} [${event.type}] ${JSON.stringify(event)}\n`;

        appendFileSync(logPath, line, "utf-8");
      });

      return { log, getLogPath };
    }),
  }
) {}
