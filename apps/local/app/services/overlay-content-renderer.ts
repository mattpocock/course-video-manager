import crypto from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Stream } from "effect";
import { overlayRendererBinPath } from "./overlay-renderer-bin";
import {
  OVERLAY_RENDER_FPS,
  OVERLAY_RENDER_FRAME,
  type OverlayContent,
} from "./overlay-render-cache";

export class OverlayContentRenderError extends Data.TaggedError(
  "OverlayContentRenderError"
)<{
  cause: unknown;
  message: string;
}> {}

/**
 * The props one Overlay's content is rendered with.
 *
 * An Overlay's content is rendered as its own clip — exactly as long as the
 * Overlay itself, not as long as the video it will be composited onto — so the
 * composition's duration and the content's duration are the same number of
 * frames, and the content starts on frame 0. That is what makes the render
 * depend on the content alone, and so what makes it cacheable across every
 * video that shows it.
 *
 * Frame 0 is also what keeps the panel in sync with the camera. The composite
 * pass shifts this whole clip to the Overlay's start with `setpts` and gates it
 * to `[start, end]` with the same `enable=` expression the kind-derived crop
 * node carries, so a `startFrame` of anything but 0 would slide the panel off
 * the camera move it was authored against.
 *
 * The props are built structurally, as a plain object, rather than against
 * `@cvm/overlay-renderer`'s zod schema: the renderer is reached by spawning
 * `bin.mjs` precisely so Remotion's Chromium toolchain stays out of this app's
 * dependency graph, and the subprocess parses these props with that schema on
 * arrival. `overlay-content-render-props.test.ts` is what holds the two shapes
 * together.
 */
export const overlayRenderProps = (content: OverlayContent) => {
  const durationInFrames = Math.ceil(
    content.durationInSeconds * OVERLAY_RENDER_FPS
  );

  // Both arrays are always present, and one of them is always empty. The
  // renderer's composition draws every content-kind it is given, so "which kind
  // is this" is expressed by which array has the entry — the same shape the
  // vertical Shorts pipeline sends with `subtitles`/`cta`. Keeping the shape
  // uniform is also what keeps every caller of this function off a union.
  return {
    width: OVERLAY_RENDER_FRAME.width,
    height: OVERLAY_RENDER_FRAME.height,
    fps: OVERLAY_RENDER_FPS,
    durationInFrames,
    definitionCards:
      content.kind === "definitionCard"
        ? [
            {
              title: content.title,
              description: content.description,
              startFrame: 0,
              durationInFrames,
            },
          ]
        : [],
    bulletPanels:
      content.kind === "bulletPanel"
        ? [
            {
              title: content.title,
              // `revealAt` crosses this boundary in SECONDS, unconverted: the
              // panel is drawn inside a Sequence that starts where the Overlay
              // does, so the renderer reads it against the same clock the
              // authoring agent wrote it against.
              bullets: content.bullets.map((bullet) => ({
                icon: bullet.icon,
                text: bullet.text,
                revealAt: bullet.revealAt,
              })),
              startFrame: 0,
              durationInFrames,
              disableEnterAnimation: content.disableEnterAnimation,
              disableExitAnimation: content.disableExitAnimation,
            },
          ]
        : [],
  };
};

/**
 * The process boundary between this app and the Remotion overlay renderer.
 *
 * The renderer (`packages/overlay-renderer`) is deliberately not a workspace
 * dependency — spawning `bin.mjs` is the whole coupling — so this service is
 * the one place that knows how to invoke it. It exists as a service, rather
 * than a plain function, so the Overlay Render Cache can be tested against a
 * fake at exactly this boundary: no test in this repo may drive a real
 * Chromium render.
 */
export class OverlayContentRendererService extends Effect.Service<OverlayContentRendererService>()(
  "OverlayContentRendererService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      // The executor is taken here, at construction, rather than left in the
      // render's requirements: it is the renderer's own business that it runs
      // a subprocess, and callers of the Overlay Render Cache should not have
      // to carry a CommandExecutor to ask for a `.mov`.
      const executor = yield* CommandExecutor.CommandExecutor;

      /**
       * Render one Overlay's content — a Definition Card, a Bullet Panel — to
       * `outputPath` as a transparent ProRes 4444 `.mov`. Overwrites whatever
       * is there.
       */
      const renderOverlayContent = Effect.fn("renderOverlayContent")(function* (
        content: OverlayContent,
        outputPath: string
      ) {
        const propsJson = JSON.stringify(overlayRenderProps(content));

        const propsDir = path.join(tmpdir(), "cvm-overlay-content-props");
        const propsFile = path.join(
          propsDir,
          `${crypto
            .createHash("sha256")
            .update(propsJson)
            .digest("hex")
            .slice(0, 12)}.json`
        );

        yield* fs.makeDirectory(propsDir, { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(propsFile, propsJson)),
          Effect.mapError(
            (cause) =>
              new OverlayContentRenderError({
                cause,
                message: `Failed to write overlay renderer props to ${propsFile}`,
              })
          )
        );

        const binPath = overlayRendererBinPath();

        yield* Effect.scoped(
          Effect.gen(function* () {
            const process = yield* executor
              .start(
                Command.make(
                  "node",
                  binPath,
                  "--props-file",
                  propsFile,
                  "--out",
                  outputPath,
                  "--quiet"
                )
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OverlayContentRenderError({
                      cause,
                      message: `Failed to start the overlay renderer: ${String(cause)}`,
                    })
                )
              );

            // Both pipes are drained concurrently: a renderer that fills one
            // of them while nobody reads it blocks forever.
            const [, stderr] = yield* Effect.all(
              [
                process.stdout.pipe(Stream.decodeText(), Stream.mkString),
                process.stderr.pipe(Stream.decodeText(), Stream.mkString),
              ],
              { concurrency: 2 }
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new OverlayContentRenderError({
                    cause,
                    message: "Failed to read the overlay renderer's output",
                  })
              )
            );

            const exitCode = yield* process.exitCode.pipe(
              Effect.mapError(
                (cause) =>
                  new OverlayContentRenderError({
                    cause,
                    message: "Failed to await the overlay renderer",
                  })
              )
            );

            if (exitCode !== 0) {
              return yield* new OverlayContentRenderError({
                cause: null,
                message: `The overlay renderer exited with code ${exitCode}: ${stderr}`,
              });
            }
          })
        );

        yield* fs.remove(propsFile).pipe(Effect.catchAll(() => Effect.void));
      });

      return { renderOverlayContent };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
