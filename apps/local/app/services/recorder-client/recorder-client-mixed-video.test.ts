import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { VideoExportService } from "@/services/video-export-service";
import { exportVideoToItsAddress } from "@/services/course-publish-export-video";
import { SidecarContextTest } from "@/services/sidecar-context";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import { createFakeOverlayRenderCache } from "@/test-utils/fake-overlay-render-cache";
import { createFakeVideoEditorLogger } from "@/test-utils/fake-video-editor-logger";
import {
  honestRenderedDurationInSeconds,
  soundExportDurationProbe,
} from "@/test-utils/fake-video-processing";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import { requireRecordableVideo } from "./record-guard.server";
import {
  clipTimes,
  connectClient,
  speak,
  startService,
  tmp,
} from "./recorder-client-test-harness";

/**
 * A Clip's Recorder is its own (ADR 0036, ADR 0051): a Video holding an old
 * OBS Clip records with the CVM recorder, and exports both Clips, each drawn
 * from its own Footage. No hardware: the recorder service runs on a scripted
 * Windows with a fake ffmpeg, and the export's ffmpeg is a fake that records
 * what it was asked to draw.
 */

setupClipServiceTests();

const videoOps = () => {
  const db = Layer.succeed(DrizzleService, testDb as never);
  return VideoOperationsService.Default.pipe(
    Layer.provide(CourseOperationsService.Default.pipe(Layer.provide(db))),
    Layer.provide(db)
  );
};

/** An export ffmpeg that writes a stand-in file and keeps what it was asked to draw. */
const fakeExport = (outputDirectory: string) => {
  const drawn: { inputVideo: string; composite: unknown }[][] = [];
  const layer = Layer.succeed(VideoExportService, {
    exportVideoClips: (opts: {
      videoId: string;
      clips: { inputVideo: string; composite: unknown; duration: number }[];
    }) =>
      Effect.sync(() => {
        drawn.push(opts.clips);
        const outputPath = path.join(outputDirectory, `${opts.videoId}.mp4`);
        fs.writeFileSync(outputPath, "fake export");
        return {
          outputPath,
          durationInSeconds: honestRenderedDurationInSeconds(opts),
        };
      }),
    getVideoDurationInSeconds: soundExportDurationProbe,
  } as never);
  return { layer, drawn };
};

describe("a Video mixing OBS and CVM-recorder Clips", () => {
  it("records with the CVM recorder beside an old OBS Clip, and exports both Clips", async () => {
    const video = await clipService.createVideo("Mixed");
    await clipService.appendClips({
      videoId: video.id,
      insertionPoint: { type: "start" },
      items: [],
      clips: [{ inputVideo: "/obs/take.mkv", startTime: 0, endTime: 5 }],
    });

    const { port, windows } = await startService();
    const client = connectClient(port);
    const heard: CvmRecorderMessage[] = [];
    client.subscribe(video.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    await client.switchScene(video.id, "Camera");
    const { format } = await Effect.runPromise(
      requireRecordableVideo(testDb as never, video.id)
    );
    await client.startRecording(video.id, {
      silenceLength: "short",
      folder: tmp(),
      format,
    });
    speak(windows.recorder("camera"), [2, 5]);
    await vi.waitFor(async () =>
      expect(await clipTimes(video.id)).toHaveLength(2)
    );
    await client.stopRecording(video.id);
    await vi.waitFor(() =>
      expect(heard.map((m) => m.type)).toContain("recording-stopped")
    );

    const root = tmp();
    const finished = path.join(root, "finished-videos");
    fs.mkdirSync(finished);
    const exporter = fakeExport(finished);
    await Effect.runPromise(
      exportVideoToItsAddress({
        videoId: video.id,
        storageRoots: [root],
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            videoOps(),
            exporter.layer,
            createFakeOverlayRenderCache().layer,
            createFakeVideoEditorLogger().layer,
            NodeContext.layer,
            SidecarContextTest
          )
        )
      )
    );

    expect(exporter.drawn).toHaveLength(1);
    const [first, second] = exporter.drawn[0]!;
    expect(first).toMatchObject({
      inputVideo: "/obs/take.mkv",
      composite: null,
    });
    expect(second!.composite).toMatchObject({ format: "landscape" });
  });
});
