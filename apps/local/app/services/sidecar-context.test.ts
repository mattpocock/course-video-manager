import { describe, expectTypeOf, it } from "vitest";
import { Effect } from "effect";
import type { LayerLive } from "./layer.server";
import { AutofillService } from "./autofill-service";
import { CoursePublishService } from "./course-publish-service";
import type { CoursePublishReadService } from "./course-publish-reads";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { runFfmpegWithProgress } from "./ffmpeg-run";
import { OverlayContentRendererService } from "./overlay-content-renderer";
import type { OverlayRenderCacheService } from "./overlay-render-cache.server";
import { RenderVerticalVideoService } from "./render-vertical-video-service";
import type { SidecarContext } from "./sidecar-context";
import type { VideoExportService } from "./video-export-service";
import { WhisperTranscriptionService } from "./whisper-transcription-service";
import { ANNOUNCE_NOTHING } from "@/packages/course-json";

// The runtime guard of docs/plans/background-jobs-sidecar.md, section 3.7:
// work that has moved into a Job needs `SidecarContext`, which only the
// Sidecar's layer (`sidecar/sidecar-layer.ts`) provides, and the services
// that do it are not in the app server's `layerLive` at all. `makeAction` /
// `makeLoader` and `runtimeLive` accept only what `LayerLive` provides, so a
// route that reaches this work fails to compile. These are type checks:
// `pnpm typecheck` fails them, not the test run.

/** Whether `E` asks for the Sidecar. */
type NeedsSidecar<E extends Effect.Effect<unknown, unknown, unknown>> = Extract<
  Effect.Effect.Context<E>,
  SidecarContext
>;

describe("SidecarContext", () => {
  it("layerLive has none of the Sidecar's services, and has the read side of Publish", () => {
    expectTypeOf<
      Extract<
        LayerLive,
        | CoursePublishService
        | RenderVerticalVideoService
        | FFmpegEncodeService
        | VideoExportService
        | OverlayRenderCacheService
        | WhisperTranscriptionService
      >
    >().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<LayerLive, CoursePublishReadService>
    >().toEqualTypeOf<CoursePublishReadService>();
  });

  it("an ffmpeg encode needs the Sidecar", () => {
    const encode = runFfmpegWithProgress({
      args: [],
      totalDurationSeconds: 1,
      onProgress: undefined,
      onLog: () => {},
      errorPrefix: "",
      permit: "encode-slot",
    });
    expectTypeOf<NeedsSidecar<typeof encode>>().toEqualTypeOf<SidecarContext>();
    const composite = Effect.flatMap(FFmpegEncodeService, (ffmpeg) =>
      ffmpeg.compositeOverlay("a.mp4", "b.mov", "c.mp4", () => {})
    );
    expectTypeOf<
      NeedsSidecar<typeof composite>
    >().toEqualTypeOf<SidecarContext>();
  });

  it("an Overlay render needs the Sidecar", () => {
    const render = Effect.flatMap(OverlayContentRendererService, (renderer) =>
      renderer.renderOverlayContent(
        {} as Parameters<typeof renderer.renderOverlayContent>[0],
        "out.mov"
      )
    );
    expectTypeOf<NeedsSidecar<typeof render>>().toEqualTypeOf<SidecarContext>();
  });

  it("a vertical render needs the Sidecar", () => {
    const render = Effect.flatMap(RenderVerticalVideoService, (service) =>
      service.renderVerticalVideo({ videoId: "a-video" })
    );
    expectTypeOf<NeedsSidecar<typeof render>>().toEqualTypeOf<SidecarContext>();
  });

  it("a Clip transcription needs the Sidecar", () => {
    const clips = Effect.flatMap(WhisperTranscriptionService, (whisper) =>
      whisper.transcribeClips([
        { id: "a-clip", inputVideo: "a.mp4", startTime: 0, duration: 1 },
      ])
    );
    expectTypeOf<NeedsSidecar<typeof clips>>().toEqualTypeOf<SidecarContext>();
  });

  it("a Batch export, a Video export and a Publish need the Sidecar", () => {
    const batch = Effect.flatMap(CoursePublishService, (service) =>
      service.batchExport("a-version", true)
    );
    expectTypeOf<NeedsSidecar<typeof batch>>().toEqualTypeOf<SidecarContext>();
    const exported = Effect.flatMap(CoursePublishService, (service) =>
      service.exportVideo("a-video")
    );
    expectTypeOf<
      NeedsSidecar<typeof exported>
    >().toEqualTypeOf<SidecarContext>();
    const publish = Effect.flatMap(CoursePublishService, (service) =>
      service.publish({
        courseId: "a-course",
        versionName: "v1.0.0",
        versionDescription: "first cut",
        includeTodoLessons: true,
        placeholderFloor: ANNOUNCE_NOTHING,
      })
    );
    expectTypeOf<
      NeedsSidecar<typeof publish>
    >().toEqualTypeOf<SidecarContext>();
  });

  it("a Course Autofill needs the Sidecar: layerLive cannot run it", () => {
    const autofill = Effect.flatMap(AutofillService, (service) =>
      service.autofillCourseVersion({
        versionId: "a-version",
        includeTodoLessons: true,
      })
    );
    type Missing = Exclude<Effect.Effect.Context<typeof autofill>, LayerLive>;
    expectTypeOf<Missing>().toEqualTypeOf<SidecarContext>();
  });
});
