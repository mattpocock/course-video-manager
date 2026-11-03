import crypto from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Stream } from "effect";
import { overlayRendererBinPath } from "./overlay-renderer-bin";
import type { OverlayContent } from "./overlay-render-cache";
import { overlayRenderProps } from "./overlay-content-props";
import { removeBestEffort } from "@/services/remove-best-effort";
import { SidecarContext } from "./sidecar-context";

export class OverlayContentRenderError extends Data.TaggedError(
  "OverlayContentRenderError"
)<{
  cause: unknown;
  message: string;
}> {}

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
        // A render boots Chromium for minutes: a Job's work, so only the
        // Sidecar provides this (docs/plans/background-jobs-sidecar.md).
        yield* SidecarContext;
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

        yield* removeBestEffort(fs, propsFile);
      });

      return { renderOverlayContent };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
