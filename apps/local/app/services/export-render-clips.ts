import { Effect } from "effect";
import {
  clipComposite,
  clipFfmpegInput,
  clipLayers,
  clipSource,
  type ClipSourceRow,
} from "@/packages/clip-source";
import type { StorageRoots } from "@/packages/storage";
import type { VideoFormat } from "@/features/videos/video-format";
import { resolveClipSourceFiles } from "./clip-source-files.server";
import {
  clipExportDurationInSeconds,
  type ExportClipDuration,
} from "./export-duration-check";

/**
 * A Video's Clips as its course export draws them, each one's files found on
 * a Storage Root (or "Footage not found (E: offline?)"), cut to the seconds
 * the export asks for (`paddedClipDurationsInSeconds`). Shared by the export
 * (`course-publish-export-video.ts`) and `cvm clip frame` on a Landscape
 * Video (`clip-frame.ts`), so a composed frame is drawn from the same plan.
 */
export const exportRenderClips = (
  clips: ReadonlyArray<ClipSourceRow & { readonly zoomType: string }>,
  opts: {
    readonly videoFormat: VideoFormat;
    readonly storageRoots: StorageRoots;
    readonly clipDurations: ReadonlyArray<ExportClipDuration>;
  }
) =>
  Effect.forEach(clips, (clip, index) =>
    Effect.gen(function* () {
      // Its Scene Layer drawn in the Video's format, as it is hashed.
      const source = yield* resolveClipSourceFiles(
        clipSource(clip, { videoFormat: opts.videoFormat }),
        opts.storageRoots
      );
      const input = clipFfmpegInput(source);
      const asked = opts.clipDurations[index]!;
      return {
        ...input,
        duration: asked.duration,
        pauseType: asked.pauseType,
        zoomType: clip.zoomType,
        // Drawn over everything the Clip outputs, long Pause included.
        composite: clipComposite(source, {
          durationSeconds: clipExportDurationInSeconds(asked),
        }),
        layers: clipLayers(source),
      };
    })
  );
