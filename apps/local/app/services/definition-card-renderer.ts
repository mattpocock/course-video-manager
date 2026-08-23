import crypto from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Stream } from "effect";
import { overlayRendererBinPath } from "./overlay-renderer-bin";
import {
  DEFINITION_CARD_FPS,
  DEFINITION_CARD_FRAME,
  type DefinitionCardContent,
} from "./overlay-render-cache";

export class DefinitionCardRenderError extends Data.TaggedError(
  "DefinitionCardRenderError"
)<{
  cause: unknown;
  message: string;
}> {}

/**
 * The props one Definition Card is rendered with.
 *
 * A card is rendered as its own clip — exactly as long as the card itself, not
 * as long as the video it will be composited onto — so the composition's
 * duration and the card's duration are the same number of frames, and the card
 * starts on frame 0. That is what makes the render depend on the card's content
 * alone, and so what makes it cacheable across every video that shows it.
 */
export const definitionCardRenderProps = (content: DefinitionCardContent) => {
  const durationInFrames = Math.ceil(
    content.durationInSeconds * DEFINITION_CARD_FPS
  );
  return {
    width: DEFINITION_CARD_FRAME.width,
    height: DEFINITION_CARD_FRAME.height,
    fps: DEFINITION_CARD_FPS,
    durationInFrames,
    definitionCards: [
      {
        title: content.title,
        description: content.description,
        durationInFrames,
      },
    ],
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
export class DefinitionCardRendererService extends Effect.Service<DefinitionCardRendererService>()(
  "DefinitionCardRendererService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      // The executor is taken here, at construction, rather than left in the
      // render's requirements: it is the renderer's own business that it runs
      // a subprocess, and callers of the Overlay Render Cache should not have
      // to carry a CommandExecutor to ask for a `.mov`.
      const executor = yield* CommandExecutor.CommandExecutor;

      /**
       * Render one Definition Card to `outputPath` as a transparent ProRes
       * 4444 `.mov`. Overwrites whatever is there.
       */
      const renderDefinitionCard = Effect.fn("renderDefinitionCard")(function* (
        content: DefinitionCardContent,
        outputPath: string
      ) {
        const propsJson = JSON.stringify(definitionCardRenderProps(content));

        const propsDir = path.join(tmpdir(), "cvm-definition-card-props");
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
              new DefinitionCardRenderError({
                cause,
                message: `Failed to write Definition Card renderer props to ${propsFile}`,
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
                    new DefinitionCardRenderError({
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
                  new DefinitionCardRenderError({
                    cause,
                    message: "Failed to read the overlay renderer's output",
                  })
              )
            );

            const exitCode = yield* process.exitCode.pipe(
              Effect.mapError(
                (cause) =>
                  new DefinitionCardRenderError({
                    cause,
                    message: "Failed to await the overlay renderer",
                  })
              )
            );

            if (exitCode !== 0) {
              return yield* new DefinitionCardRenderError({
                cause: null,
                message: `The overlay renderer exited with code ${exitCode}: ${stderr}`,
              });
            }
          })
        );

        yield* fs.remove(propsFile).pipe(Effect.catchAll(() => Effect.void));
      });

      return { renderDefinitionCard };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
