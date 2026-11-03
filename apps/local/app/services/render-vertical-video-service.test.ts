import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { ConfigProvider, Effect, Layer, Stream } from "effect";
import { Command, CommandExecutor } from "@effect/platform";
import { readFileSync } from "node:fs";
import { NodeContext, NodeFileSystem, NodePath } from "@effect/platform-node";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { FFmpegEncodeService } from "@/services/ffmpeg-encode-commands";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import {
  VideoEditorLoggerService,
  type LogEvent,
} from "@/services/video-editor-logger-service";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import {
  RenderVerticalError,
  RenderVerticalVideoService,
} from "./render-vertical-video-service";
import { SidecarContextTest } from "./sidecar-context";
import { ShortOverlayRendererService } from "./short-overlay-renderer";

describe("RenderVerticalVideoService", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    const result = await createTestDb();
    testDb = result.testDb;
  });

  beforeEach(async () => {
    await truncateAllTables(testDb);
  });

  type OverlayProps = {
    durationInFrames: number;
    subtitles: { startFrame: number; endFrame: number; text: string }[];
  };

  /**
   * The render with every encode faked, down to the overlay renderer's
   * subprocess: `overlays` collects the props each render hands it, which is
   * where the subtitles end up.
   */
  function buildTestLayer(overlays: OverlayProps[] = []) {
    const dbLayer = Layer.succeed(DrizzleService, testDb as any);

    const fakeFfmpeg = Layer.succeed(FFmpegCommandsService, {
      getFPS: () => Effect.succeed(10),
    } as any);
    const fakeEncode = Layer.succeed(FFmpegEncodeService, {
      createAndConcatenateVideoClipsSinglePass: () =>
        Effect.succeed("/tmp/fake-concatenated.mp4"),
      normalizeAudio: () => Effect.succeed("/tmp/fake-normalized.mp4"),
      compositeOverlay: () => Effect.void,
    } as any);
    // Stands in for `node bin.mjs --props-file <file>`, reading the props.
    const fakeOverlayRenderer = Layer.succeed(
      CommandExecutor.CommandExecutor,
      CommandExecutor.makeExecutor((command) =>
        Effect.sync(() => {
          const args = (command as Command.StandardCommand).args;
          const propsFile = args[args.indexOf("--props-file") + 1]!;
          overlays.push(JSON.parse(readFileSync(propsFile, "utf8")));
          return {
            [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
            pid: CommandExecutor.ProcessId(0),
            exitCode: Effect.succeed(CommandExecutor.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdout: Stream.empty,
            stderr: Stream.empty,
          } as unknown as CommandExecutor.Process;
        })
      )
    );

    const configLayer = Layer.setConfigProvider(
      ConfigProvider.fromMap(
        new Map([["STORAGE_ROOTS", "/tmp/test-storage-root"]])
      )
    );

    // The real overlay-renderer boundary, over the faked subprocess.
    const overlayRendererLayer =
      ShortOverlayRendererService.DefaultWithoutDependencies.pipe(
        Layer.provide(Layer.mergeAll(NodeFileSystem.layer, fakeOverlayRenderer))
      );

    const depsLayer = Layer.mergeAll(
      overlayRendererLayer,
      VideoOperationsService.Default.pipe(Layer.provide(dbLayer)),
      ClipOperationsService.Default.pipe(Layer.provide(dbLayer)),
      fakeFfmpeg,
      fakeEncode,
      Layer.succeed(VideoEditorLoggerService, {
        log: () => Effect.void,
      } as any),
      configLayer,
      // The real file system, but no real processes: nothing is spawned.
      NodeFileSystem.layer,
      NodePath.layer,
      fakeOverlayRenderer
    );

    return Layer.mergeAll(
      depsLayer,
      // A render runs only in the Sidecar; a test stands in for it.
      SidecarContextTest,
      RenderVerticalVideoService.DefaultWithoutDependencies.pipe(
        Layer.provide(depsLayer)
      )
    );
  }

  /** A Short whose Clips are `clips`, in order, each with its Transcript Words. */
  const seedShort = (
    clips: {
      text: string;
      seconds: number;
      pauseType?: "long";
      words?: { start: number; end: number; text: string }[];
    }[]
  ) =>
    Effect.gen(function* () {
      const [video] = yield* Effect.promise(() =>
        testDb
          .insert(schema.videos)
          .values({
            title: "Short",
            originalFootagePath: "/f",
            format: "short",
          })
          .returning()
      );
      const clipOps = yield* ClipOperationsService;
      const ids: string[] = [];
      for (const [index, clip] of clips.entries()) {
        const [row] = yield* Effect.promise(() =>
          testDb
            .insert(schema.clips)
            .values({
              videoId: video!.id,
              videoFilename: "/footage/a.mp4",
              sourceStartTime: 100,
              sourceEndTime: 100 + clip.seconds,
              order: `a${index}`,
              text: clip.text,
              pauseType: clip.pauseType ?? "none",
            })
            .returning()
        );
        yield* clipOps.replaceTranscriptWords(row!.id, clip.words ?? []);
        ids.push(row!.id);
      }
      return { videoId: video!.id, clipIds: ids };
    });

  it.effect(
    "subtitles a Short from its Clips' text, timed by their Transcript Words",
    () => {
      const overlays: OverlayProps[] = [];
      return Effect.gen(function* () {
        const { videoId, clipIds } = yield* seedShort([
          {
            text: "Hello there.",
            seconds: 2,
            words: [
              { start: 0.5, end: 0.9, text: "Hello" },
              { start: 1.2, end: 1.6, text: "there." },
            ],
          },
          {
            // Whisper split the hyphen; the Clip's text is what is shown.
            text: "This sentence is long enough to split in two halves",
            seconds: 3,
            words: [
              { start: 0.2, end: 0.4, text: "This" },
              { start: 0.4, end: 0.6, text: "sentence" },
              { start: 0.6, end: 0.8, text: "is" },
              { start: 0.8, end: 1, text: "long" },
              { start: 1, end: 1.2, text: "enough" },
              { start: 1.6, end: 1.8, text: "to" },
              { start: 1.8, end: 2, text: "split" },
              { start: 2, end: 2.2, text: "in" },
              { start: 2.2, end: 2.4, text: "two" },
              { start: 2.4, end: 2.6, text: "halves" },
            ],
          },
        ]);
        const service = yield* RenderVerticalVideoService;
        yield* service.renderVerticalVideo({ videoId });

        // 10 fps. The second Clip starts at 2 s; its second phrase at the
        // word "to", 1.6 s into it.
        expect(overlays[0]!.subtitles).toEqual([
          { startFrame: 0, endFrame: 22, text: "Hello there." },
          {
            startFrame: 22,
            endFrame: 36,
            text: "This sentence is long enough",
          },
          { startFrame: 36, endFrame: 50, text: "to split in two halves" },
        ]);

        // Editing a Clip's text changes the Short's subtitles.
        const clipOps = yield* ClipOperationsService;
        yield* clipOps.updateClip(clipIds[0]!, { text: "Hi there." });
        yield* service.renderVerticalVideo({ videoId });
        expect(overlays[1]!.subtitles[0]).toEqual({
          startFrame: 0,
          endFrame: 22,
          text: "Hi there.",
        });
      }).pipe(Effect.provide(buildTestLayer(overlays)));
    }
  );

  it.effect(
    "leaves no gap: from frame 0 to the Short's last, one subtitle is always showing",
    () => {
      const overlays: OverlayProps[] = [];
      return Effect.gen(function* () {
        const { videoId } = yield* seedShort([
          // Silence before, between and after its words.
          {
            text: "First words. Then much later, more words.",
            seconds: 6,
            words: [
              { start: 1, end: 1.3, text: "First" },
              { start: 1.3, end: 1.6, text: "words." },
              { start: 4, end: 4.2, text: "Then" },
              { start: 4.2, end: 4.4, text: "much" },
              { start: 4.4, end: 4.6, text: "later," },
              { start: 4.6, end: 4.8, text: "more" },
              { start: 4.8, end: 5, text: "words." },
            ],
            pauseType: "long",
          },
          // Filmed before Transcript Words existed: it has none.
          {
            text: "A Clip with no word timings at all, still subtitled",
            seconds: 4,
          },
        ]);
        const service = yield* RenderVerticalVideoService;
        yield* service.renderVerticalVideo({ videoId });

        const { subtitles, durationInFrames } = overlays[0]!;
        // 6 s + the long Pause's 0.18 s + 4 s, at 10 fps.
        expect(durationInFrames).toBe(102);
        expect(subtitles[0]!.startFrame).toBe(0);
        expect(subtitles.at(-1)!.endFrame).toBe(durationInFrames);
        for (const [index, subtitle] of subtitles.entries()) {
          expect(subtitle.endFrame).toBeGreaterThan(subtitle.startFrame);
          if (index > 0) {
            expect(subtitle.startFrame).toBe(subtitles[index - 1]!.endFrame);
          }
        }
        expect(subtitles.map((s) => s.text).join(" ")).toBe(
          "First words. Then much later, more words. A Clip with no word timings at all, still subtitled"
        );
      }).pipe(Effect.provide(buildTestLayer(overlays)));
    }
  );

  it.effect("rejects when video has no clips", () =>
    Effect.gen(function* () {
      const [video] = yield* Effect.promise(() =>
        testDb
          .insert(schema.videos)
          .values({
            title: "Empty Short",
            originalFootagePath: "/footage/empty.mp4",
            format: "short",
          })
          .returning()
      );

      const service = yield* RenderVerticalVideoService;
      const result = yield* service
        .renderVerticalVideo({ videoId: video!.id })
        .pipe(Effect.flip);

      expect(result._tag).toBe("RenderVerticalError");
    }).pipe(Effect.provide(buildTestLayer()))
  );

  it.effect("rejects when video does not exist", () =>
    Effect.gen(function* () {
      const service = yield* RenderVerticalVideoService;
      const result = yield* service
        .renderVerticalVideo({ videoId: "nonexistent-id" })
        .pipe(Effect.flip);

      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(buildTestLayer()))
  );

  it.effect(
    "records a failed stage in the video's own log, not only the SSE error",
    () => {
      const logged: { videoId: string; event: LogEvent }[] = [];

      const dbLayer = Layer.succeed(DrizzleService, testDb as any);
      const depsLayer = Layer.mergeAll(
        VideoOperationsService.Default.pipe(Layer.provide(dbLayer)),
        ClipOperationsService.Default.pipe(Layer.provide(dbLayer)),
        // Never reached: each fails at the concat, before the overlay.
        ShortOverlayRendererService.Default,
        Layer.succeed(FFmpegCommandsService, {} as any),
        Layer.succeed(FFmpegEncodeService, {
          createAndConcatenateVideoClipsSinglePass: () =>
            Effect.fail(
              new RenderVerticalError({
                cause: null,
                message: "ffmpeg concat blew up",
              })
            ),
        } as any),
        Layer.succeed(VideoEditorLoggerService, {
          log: (videoId: string, event: LogEvent) =>
            Effect.sync(() => {
              logged.push({ videoId, event });
            }),
          getLogPath: () => "/dev/null",
        } as any),
        Layer.setConfigProvider(
          ConfigProvider.fromMap(
            new Map([["STORAGE_ROOTS", "/tmp/test-storage-root"]])
          )
        ),
        NodeContext.layer
      );

      return Effect.gen(function* () {
        const [video] = yield* Effect.promise(() =>
          testDb
            .insert(schema.videos)
            .values({
              title: "Broken Short",
              originalFootagePath: "/footage/short.mp4",
              format: "short",
            })
            .returning()
        );
        yield* Effect.promise(() =>
          testDb.insert(schema.clips).values({
            videoId: video!.id,
            videoFilename: "/footage/a.mp4",
            sourceStartTime: 0,
            sourceEndTime: 10,
            order: "0001",
            text: "hello",
          })
        );

        const service = yield* RenderVerticalVideoService;
        const error = yield* service
          .renderVerticalVideo({ videoId: video!.id })
          .pipe(Effect.flip);

        expect(error.message).toBe("ffmpeg concat blew up");
        expect(logged).toEqual([
          {
            videoId: video!.id,
            event: expect.objectContaining({
              type: "export-stage-failed",
              stage: "short:concatenating-clips",
              message: "ffmpeg concat blew up",
            }),
          },
        ]);
      }).pipe(
        Effect.provide(
          RenderVerticalVideoService.DefaultWithoutDependencies.pipe(
            Layer.provide(depsLayer)
          )
        ),
        // The overlay step spawns a subprocess, so the render itself (not just
        // the service's construction) needs a CommandExecutor in context.
        // A render runs only in the Sidecar; a test stands in for it.
        Effect.provide(Layer.merge(NodeContext.layer, SidecarContextTest))
      );
    }
  );

  it.effect(
    "renders a CVM-recorder Clip as its composite, through the Clip Source",
    () => {
      const segmentCalls: unknown[] = [];
      const singlePassCalls: unknown[] = [];
      const stop = new RenderVerticalError({ cause: null, message: "stop" });

      const dbLayer = Layer.succeed(DrizzleService, testDb as any);
      const depsLayer = Layer.mergeAll(
        VideoOperationsService.Default.pipe(Layer.provide(dbLayer)),
        ClipOperationsService.Default.pipe(Layer.provide(dbLayer)),
        // Never reached: each fails at the concat, before the overlay.
        ShortOverlayRendererService.Default,
        Layer.succeed(FFmpegCommandsService, {} as any),
        Layer.succeed(FFmpegEncodeService, {
          concatenateClipSegments: (clips: unknown) => {
            segmentCalls.push(clips);
            return Effect.fail(stop);
          },
          createAndConcatenateVideoClipsSinglePass: (clips: unknown) => {
            singlePassCalls.push(clips);
            return Effect.fail(stop);
          },
        } as any),
        Layer.succeed(VideoEditorLoggerService, {
          log: () => Effect.void,
        } as any),
        Layer.setConfigProvider(
          ConfigProvider.fromMap(
            new Map([["STORAGE_ROOTS", "/tmp/test-storage-root"]])
          )
        ),
        NodeContext.layer
      );

      return Effect.gen(function* () {
        const [video] = yield* Effect.promise(() =>
          testDb
            .insert(schema.videos)
            .values({
              title: "Short",
              originalFootagePath: "/rec",
              format: "short",
            })
            .returning()
        );
        const [session] = yield* Effect.promise(() =>
          testDb
            .insert(schema.recordingSessions)
            .values({
              videoId: video!.id,
              cameraFilePath: "/rec/s1/camera.mkv",
              screenFilePath: "/rec/s1/screen.mkv",
              micFilePath: "/rec/s1/mic.mkv",
            })
            .returning()
        );
        yield* Effect.promise(() =>
          testDb.insert(schema.clips).values({
            videoId: video!.id,
            videoFilename: "/rec/s1/mic.mkv",
            sourceStartTime: 2,
            sourceEndTime: 6,
            order: "a0",
            text: "hello",
            recordingSessionId: session!.id,
            sceneOverride: "Code",
          })
        );

        const service = yield* RenderVerticalVideoService;
        yield* service
          .renderVerticalVideo({ videoId: video!.id })
          .pipe(Effect.flip);

        expect(singlePassCalls).toEqual([]);
        expect(segmentCalls).toEqual([
          [
            expect.objectContaining({
              startTime: 1.85,
              duration: 4,
              composite: expect.objectContaining({
                start: 2,
                screen: "/rec/s1/screen.mkv",
                camera: "/rec/s1/camera.mkv",
                mic: "/rec/s1/mic.mkv",
                segments: [{ scene: "Code", startSeconds: 2, endSeconds: 6 }],
              }),
            }),
          ],
        ]);
      }).pipe(
        Effect.provide(
          RenderVerticalVideoService.DefaultWithoutDependencies.pipe(
            Layer.provide(depsLayer)
          )
        ),
        Effect.provide(Layer.merge(NodeContext.layer, SidecarContextTest))
      );
    }
  );
});
