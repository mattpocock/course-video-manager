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
import type { OverlayContentProps } from "./overlay-content-props";

/**
 * What the overlay renderer draws: a Short's one overlay (its captions and
 * Chat Cards), or one Overlay's content (a Definition Card or a Bullet
 * Panel, `overlayRenderProps`). One composition takes both.
 */
export type OverlayRendererProps = ShortOverlayProps | OverlayContentProps;

export class OverlayRendererError extends Data.TaggedError(
  "OverlayRendererError"
)<{
  cause: unknown;
  message: string;
}> {}

/**
 * The process boundary to the Remotion overlay renderer (`bin.mjs`), drawing
 * `props` with the renderer's own `args` (`--out` for the whole `.mov`,
 * `--frame` for one PNG). A Short's whole overlay is the Sidecar's
 * (`short-overlay-renderer.ts`); one frame is not. (An Overlay's whole
 * content render is the Sidecar's too, `overlay-content-renderer.ts`.)
 */
export const runOverlayRenderer = (
  props: OverlayRendererProps,
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
        new OverlayRendererError({
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
              new OverlayRendererError({
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
          return yield* new OverlayRendererError({
            cause: null,
            message: `Overlay renderer exited with code ${exitCode}: ${stderr}`,
          });
        }
      })
    ).pipe(Effect.ensuring(removeBestEffort(effectFs, propsFile)));
  });

/**
 * One frame of an overlay as a transparent PNG: a Short's captions and Chat
 * Cards, or a Landscape Video's Definition Card or Bullet Panel. It is what
 * `cvm clip frame` and the editor's preview (`/clips/:clipId/frame`) join
 * over a Clip's picture, so the frame is drawn by the render's own
 * composition.
 * Someone waits on it, as on a still: one Chromium frame, a few seconds. A
 * service so tests can fake it: no test here may drive a real Chromium
 * render.
 */
export class OverlayFrameService extends Effect.Service<OverlayFrameService>()(
  "OverlayFrameService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* CommandExecutor.CommandExecutor;

      /** Frame `frame` of the overlay composition, as a transparent PNG. */
      const renderFrame = Effect.fn("renderOverlayFrame")(function* (
        props: OverlayRendererProps,
        frame: number,
        outputPath: string
      ) {
        yield* runOverlayRenderer(props, [
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
