import { CommandExecutor, FileSystem } from "@effect/platform";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { Effect } from "effect";
import { SidecarContext } from "./sidecar-context";
import { runOverlayRenderer } from "./overlay-frame";
import type { ShortOverlayProps } from "./short-render-clips";

/**
 * The vertical render's overlay: a Short's captions and Chat Cards, the whole
 * of it as a transparent `.mov`, through the overlay renderer's process
 * boundary (`runOverlayRenderer`). Chromium for the whole Short is a
 * Job's work, so only the Sidecar reaches this. One frame of the same
 * composition is `OverlayFrameService` (`overlay-frame.ts`). A
 * service so tests can fake it: no test here may drive a real Chromium render.
 */
export class ShortOverlayRendererService extends Effect.Service<ShortOverlayRendererService>()(
  "ShortOverlayRendererService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* CommandExecutor.CommandExecutor;

      /** The whole overlay as a transparent ProRes 4444 `.mov`: a Job's work. */
      const renderVideo = Effect.fn("renderShortOverlayVideo")(function* (
        props: ShortOverlayProps,
        outputPath: string
      ) {
        // Chromium for the whole Short: only the Sidecar provides this.
        yield* SidecarContext;
        yield* runOverlayRenderer(props, ["--out", outputPath]).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        );
      });

      return { renderVideo };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
