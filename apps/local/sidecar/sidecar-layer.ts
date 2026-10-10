import { Layer } from "effect";
import { layerLive } from "@/services/layer.server";
import { CoursePublishService } from "@/services/course-publish-service";
import { FFmpegEncodeService } from "@/services/ffmpeg-encode-commands";
import { OverlayRenderCacheService } from "@/services/overlay-render-cache.server";
import { RenderVerticalVideoService } from "@/services/render-vertical-video-service";
import { SidecarContextLive } from "@/services/sidecar-context";
import { VideoExportService } from "@/services/video-export-service";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { ClipMockupVoiceOperationsService } from "@/services/db-clip-mockup-voice-operations.server";
import { LocalWhisperEngineLive } from "./local-whisper-engine";

/**
 * The work only the **Sidecar** does: the encodes (`FFmpegEncodeService`,
 * through `ffmpeg-run.ts`), the Overlay renderer (Remotion's `bin.mjs`, behind
 * `OverlayRenderCacheService`), and the services built on them — a course
 * export, a Batch export and a Publish (`CoursePublishService`), the
 * vertical Short (`RenderVerticalVideoService`), and Whisper transcription
 * (`WhisperTranscriptionService`: ffmpeg extracts a Clip's audio for it).
 *
 * None of it is in the app server's `layerLive`, and no module a route can
 * reach imports this file (`.dependency-cruiser.cjs`,
 * `spawn-runner-reachable-from-routes`), so a request cannot start an encode:
 * it enqueues a Job instead (docs/plans/background-jobs-sidecar.md, the spawn
 * guard). `SidecarContext` is provided here and nowhere else.
 */
const encodeLayer = Layer.mergeAll(
  FFmpegEncodeService.Default,
  VideoExportService.Default,
  OverlayRenderCacheService.Default
);

export const sidecarLayer = Layer.mergeAll(
  CoursePublishService.Default,
  RenderVerticalVideoService.Default,
  WhisperTranscriptionService.Default,
  // Records a Clip Mockup's voice once the `clip-mockup-voice` Job made it.
  ClipMockupVoiceOperationsService.Default
).pipe(
  Layer.provideMerge(encodeLayer),
  Layer.provideMerge(layerLive),
  Layer.provideMerge(SidecarContextLive),
  // Local Whisper: its env made ready when the Sidecar starts, and one
  // worker shared by every WhisperTranscriptionService built above.
  Layer.provideMerge(LocalWhisperEngineLive)
);

/** Every service a Job's handler may ask for. */
export type SidecarServices = Layer.Layer.Success<typeof sidecarLayer>;
