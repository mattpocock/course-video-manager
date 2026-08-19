import { Effect } from "effect";
import type { FfmpegLogInfo } from "./ffmpeg-commands";
import type { VideoEditorLoggerService } from "./video-editor-logger-service";

/**
 * Bridges FFmpegCommandsService's `onLog` callback (a plain sync function —
 * ffmpeg-commands.ts has no Effect Context of its own to run inside, and no
 * notion of a videoId) to VideoEditorLoggerService's per-video "cli-output"
 * event. The one place both exportVideoClips and renderVerticalVideo build
 * their ffmpeg loggers from, so the two don't drift.
 *
 * VideoEditorLoggerService.log is a synchronous fs write (appendFileSync),
 * so Effect.runSync is exact here — no detached fiber, no lost writes if the
 * process exits right after export completes. Logging is best-effort: a
 * disk hiccup must never fail the export it exists to help explain.
 */
export const makeFfmpegLogger =
  (
    logger: Pick<VideoEditorLoggerService, "log">,
    videoId: string,
    stage: string
  ) =>
  (info: FfmpegLogInfo): void => {
    try {
      Effect.runSync(
        logger.log(videoId, {
          type: "cli-output",
          command: `[${stage}] ${info.command.join(" ")}`,
          stderr: info.stderrTail,
        })
      );
    } catch {
      // Best-effort only — never let a logging failure fail the export.
    }
  };
