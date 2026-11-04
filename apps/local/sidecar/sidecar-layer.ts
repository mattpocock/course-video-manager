import { Layer } from "effect";
import { layerLiveOn } from "@/services/layer.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CoursePublishService } from "@/services/course-publish-service";
import { FFmpegEncodeService } from "@/services/ffmpeg-encode-commands";
import { OverlayRenderCacheService } from "@/services/overlay-render-cache.server";
import { RenderVerticalVideoService } from "@/services/render-vertical-video-service";
import { SidecarContextLive } from "@/services/sidecar-context";
import { VideoExportService } from "@/services/video-export-service";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { ClipMockupVoiceOperationsService } from "@/services/db-clip-mockup-voice-operations.server";
import { PostingQueueSidecarService } from "@/services/db-posting-queue-sidecar.server";
import { LocalWhisperEngineLive } from "./local-whisper-engine";
import { recorderGpuGateLayer } from "@/services/gpu-gate";
import { stillGateRecorderUrl } from "@/services/recorder-still-gate";
import { SIDECAR_TIMING } from "./sidecar-timing";

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

/**
 * A Job can wait for its database: on a network drop its queries wait and
 * try again, for as long as the Sidecar itself rides out an outage
 * (`DbPatience`, #2621), rather than fail an hour-long Publish on the first
 * try. The Sidecar's own bookkeeping — its lease, heartbeats, settling a Job,
 * the socket — stays on the impatient client (`run-sidecar.ts`), so it sees
 * the outage at once and a stop is never held up.
 */
const jobDatabase = DrizzleService.Patient({
  windowMs: SIDECAR_TIMING.outageToleranceMs,
});

export const sidecarLayer = Layer.mergeAll(
  CoursePublishService.Default,
  RenderVerticalVideoService.Default,
  WhisperTranscriptionService.Default,
  // Records a Clip Mockup's voice once the `clip-mockup-voice` Job made it.
  ClipMockupVoiceOperationsService.Default,
  // The Posting Queue tick, and the posting Jobs it enqueues.
  PostingQueueSidecarService.Default
).pipe(
  Layer.provideMerge(encodeLayer),
  Layer.provideMerge(layerLiveOn(jobDatabase)),
  Layer.provideMerge(SidecarContextLive),
  // Local Whisper: its env made ready when the Sidecar starts, and one
  // worker shared by every WhisperTranscriptionService built above.
  Layer.provideMerge(LocalWhisperEngineLive),
  // No Whisper pass starts while a Recording Session or Live Stream is live
  // (#2631): the recorder service's /health, the one `cvm`'s Still Gate reads.
  Layer.provideMerge(
    Layer.suspend(() => recorderGpuGateLayer(stillGateRecorderUrl(process.env)))
  )
);

/** Every service a Job's handler may ask for. */
export type SidecarServices = Layer.Layer.Success<typeof sidecarLayer>;
