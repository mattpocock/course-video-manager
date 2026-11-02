import { Command } from "@effect/cli";
import { Effect, Option } from "effect";
import { ShortOverlayRendererService } from "@/services/short-overlay-renderer";
import { shortClipFrame } from "@/services/short-clip-frame";
import { detail, emitObject } from "@/cli/helpers";
import { NEEDS_FOOTAGE_ON_DISK, requireLocalMachine } from "@/cli/local-only";
import { entityIdArg } from "../entity-id";
import { requireActiveClip } from "./clip.shared";
import { atOption, frameLayer } from "./footage-frame";

export const CLIP_FRAME_HELP = `A PNG of a Short's Clip as its post shows it, t seconds into the Clip.

  cvm clip frame --at <t> <clip>

The composed frame, at the Video's size (1080x1920): the Clip's Layers bottom to
top (its Scene Layer in the Short layout, each Footage Layer's Source Crop at its
Placement), then the captions and the Chat Cards above them. It is drawn by the
render's own code — the Clip's export segment and one frame of the Short's
overlay render — so what it shows is what 'cvm short render' will post. Use it
after 'clip layer add|update' to check a crop, a band or a card.

<t> is seconds into the Clip (0 is its first frame; its long Pause counts). The
frame is the one showing at t, on the render's 60 fps.

Prints { path, clipId, at }: 'path' is a NEW PNG in the temp directory
(cvm-frames/) each time.

THE STILL GATE. It decodes raw footage, so it is refused while any Recording
Session records (or a stopped take is still closing its files): _tag
"StillHeldError", exit 3, "No still while recording: ask again after the Stop".

Refused (exit 3): a t outside the Clip; a Clip on a Landscape Video (only a
Short's frame is drawn here yet). An unknown or deleted clip is not-found (exit
2); its Footage offline is exit 4. Local-only (exit 7 elsewhere). It runs the
overlay renderer (Chromium) once, so a frame takes several seconds.`;

/** The test's fake renderer when one is provided; this machine's otherwise. */
const withOverlayRenderer = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.serviceOption(ShortOverlayRendererService), (given) =>
    Option.isSome(given)
      ? effect.pipe(
          Effect.provideService(ShortOverlayRendererService, given.value)
        )
      : effect.pipe(Effect.provide(ShortOverlayRendererService.Default))
  );

export const clipFrameCmd = Command.make(
  "frame",
  { clip: entityIdArg("clip"), at: atOption },
  ({ clip, at }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine("cvm clip frame", NEEDS_FOOTAGE_ON_DISK);
      yield* requireActiveClip(clip);
      const png = yield* shortClipFrame(clip, at).pipe(
        withOverlayRenderer,
        Effect.provide(frameLayer())
      );
      yield* emitObject({ path: png, clipId: clip, at });
    })
).pipe(Command.withDescription(detail(CLIP_FRAME_HELP)));
