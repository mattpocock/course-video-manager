import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { Data, Effect, Stream } from "effect";
import { overlayRendererBinPath } from "./overlay-renderer-bin";
import { removeBestEffort } from "@/services/remove-best-effort";
import { assertUnderEffect } from "./assert-under";
import type { ShortOverlayProps } from "./short-render-clips";

export class ShortOverlayRenderError extends Data.TaggedError(
  "ShortOverlayRenderError"
)<{
  cause: unknown;
  message: string;
}> {}

/**
 * The process boundary to the Remotion overlay renderer (`bin.mjs`) for a
 * Short's one overlay: its captions and Chat Cards, drawn from `props`, with
 * the renderer's own `args` (`--out` for the whole `.mov`, `--frame` for one
 * PNG). The whole overlay is the Sidecar's (`short-overlay-renderer.ts`);
 * one frame is not.
 */
export const runShortOverlayRenderer = (
  props: ShortOverlayProps,
  args: readonly string[]
) =>
  Effect.gen(function* () {
    const effectFs = yield* FileSystem.FileSystem;
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

    // The props file is scratch: removed whether the render worked or not.
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
    ).pipe(Effect.ensuring(removeBestEffort(effectFs, propsFile)));
  });

/**
 * One frame of a Short's overlay as a transparent PNG: what `cvm clip frame`
 * and the Portrait Studio's preview (`/clips/:clipId/short-frame`) join over
 * a Clip's picture, so the frame is drawn by the render's own composition.
 * Someone waits on it, as on a still: one Chromium frame, a few seconds. A
 * service so tests can fake it: no test here may drive a real Chromium
 * render.
 */
export class ShortOverlayFrameService extends Effect.Service<ShortOverlayFrameService>()(
  "ShortOverlayFrameService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* CommandExecutor.CommandExecutor;

      /** Frame `frame` of the overlay composition, as a transparent PNG. */
      const renderFrame = Effect.fn("renderShortOverlayFrame")(function* (
        props: ShortOverlayProps,
        frame: number,
        outputPath: string
      ) {
        yield* runShortOverlayRenderer(props, [
          "--frame",
          String(frame),
          "--out",
          outputPath,
        ]).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        );
      });

      return { renderFrame };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
