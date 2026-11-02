import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Stream } from "effect";
import { overlayRendererBinPath } from "./overlay-renderer-bin";
import { removeBestEffort } from "@/services/remove-best-effort";
import { SidecarContext } from "./sidecar-context";
import { assertUnderEffect } from "./assert-under";
import type { ShortOverlayProps } from "./short-render-clips";

export class ShortOverlayRenderError extends Data.TaggedError(
  "ShortOverlayRenderError"
)<{
  cause: unknown;
  message: string;
}> {}

/**
 * The process boundary to the Remotion overlay renderer for a Short's one
 * overlay: its captions and Chat Cards. The vertical render asks it for the
 * whole overlay as a transparent `.mov`; `cvm clip frame` for one frame of
 * that same composition as a transparent PNG, so the composed frame is drawn
 * by the export's own renderer. A service so tests can fake it: no test here
 * may drive a real Chromium render.
 */
export class ShortOverlayRendererService extends Effect.Service<ShortOverlayRendererService>()(
  "ShortOverlayRendererService",
  {
    effect: Effect.gen(function* () {
      const effectFs = yield* FileSystem.FileSystem;
      const executor = yield* CommandExecutor.CommandExecutor;

      const render = (props: ShortOverlayProps, args: readonly string[]) =>
        Effect.gen(function* () {
          const propsJson = JSON.stringify(props);
          const propsDir = path.join(tmpdir(), "cvm-overlay-props");
          yield* effectFs.makeDirectory(propsDir, { recursive: true });
          const propsHash = crypto
            .createHash("sha256")
            .update(propsJson)
            .digest("hex")
            .slice(0, 12);
          const propsFile = yield* assertUnderEffect(
            propsDir,
            path.join(propsDir, `${propsHash}.json`)
          );
          yield* effectFs.writeFileString(propsFile, propsJson);

          const binPath = yield* Effect.try({
            try: () => overlayRendererBinPath(),
            catch: (e) =>
              new ShortOverlayRenderError({
                cause: e,
                message: `Could not locate the overlay renderer: ${e instanceof Error ? e.message : String(e)}`,
              }),
          });

          yield* Effect.scoped(
            Effect.gen(function* () {
              const process = yield* Command.start(
                Command.make(
                  "node",
                  binPath,
                  "--props-file",
                  propsFile,
                  ...args,
                  "--quiet"
                )
              ).pipe(
                Effect.mapError(
                  (e) =>
                    new ShortOverlayRenderError({
                      cause: e,
                      message: `Failed to start overlay renderer: ${e.message}`,
                    })
                )
              );
              const [, stderr] = yield* Effect.all(
                [
                  process.stdout.pipe(Stream.decodeText(), Stream.mkString),
                  process.stderr.pipe(Stream.decodeText(), Stream.mkString),
                ],
                { concurrency: 2 }
              );
              const exitCode = yield* process.exitCode;
              if (exitCode !== 0) {
                return yield* new ShortOverlayRenderError({
                  cause: null,
                  message: `Overlay renderer exited with code ${exitCode}: ${stderr}`,
                });
              }
            })
          );

          yield* removeBestEffort(effectFs, propsFile);
        }).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        );

      /** The whole overlay as a transparent ProRes 4444 `.mov`: a Job's work. */
      const renderVideo = Effect.fn("renderShortOverlayVideo")(function* (
        props: ShortOverlayProps,
        outputPath: string
      ) {
        // Chromium for the whole Short: only the Sidecar provides this.
        yield* SidecarContext;
        yield* render(props, ["--out", outputPath]);
      });

      /** Frame `frame` of the same composition, as a transparent PNG. */
      const renderFrame = Effect.fn("renderShortOverlayFrame")(function* (
        props: ShortOverlayProps,
        frame: number,
        outputPath: string
      ) {
        yield* render(props, ["--frame", String(frame), "--out", outputPath]);
      });

      return { renderVideo, renderFrame };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
