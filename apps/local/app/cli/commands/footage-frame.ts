import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { Effect, Layer } from "effect";
import path from "node:path";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { footageFrame } from "@/services/frame-stills";
import {
  recorderStillGateLayer,
  stillGateRecorderUrl,
} from "@/services/recorder-still-gate";
import { detail, emitObject, parseError } from "@/cli/helpers";
import { footageOnDisk } from "./footage-on-disk";
import { requireLocalFootage } from "./footage-jobs";
import { FRAME_HELP } from "./footage.help";

/** `--at <t>`: seconds into the Footage (or the Clip, for `clip frame`). */
export const atOption = Options.float("at").pipe(
  Options.withDescription("Seconds into it: the frame showing at that time.")
);

/**
 * What a frame command runs inside: ffmpeg on this machine, and the Still
 * Gate on the recorder service (`recorder-still-gate.ts`), read once the
 * command runs.
 */
export const frameLayer = () =>
  Layer.mergeAll(
    FFmpegCommandsService.Default,
    NodeContext.layer,
    recorderStillGateLayer(stillGateRecorderUrl(process.env))
  );

export const frameCmd = Command.make(
  "frame",
  { path: Args.text({ name: "source" }), at: atOption },
  ({ path: typedPath, at }) =>
    Effect.gen(function* () {
      yield* requireLocalFootage;
      const fs = yield* FileSystem.FileSystem;
      const file = footageOnDisk(typedPath);
      if (!(yield* fs.exists(file))) {
        return yield* parseError(`no such footage file: ${file}`, "footage");
      }
      const png = yield* footageFrame(path.resolve(file), at).pipe(
        Effect.provide(frameLayer())
      );
      yield* emitObject({ path: png, source: path.resolve(file), at });
    })
).pipe(Command.withDescription(detail(FRAME_HELP)));
