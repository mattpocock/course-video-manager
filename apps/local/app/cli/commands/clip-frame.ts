import { Command } from "@effect/cli";
import { Effect, Option } from "effect";
import { OverlayFrameService } from "@/services/overlay-frame";
import { clipFrame } from "@/services/clip-frame";
import { detail, emitObject } from "@/cli/helpers";
import { NEEDS_FOOTAGE_ON_DISK, requireLocalMachine } from "@/cli/local-only";
import { entityIdArg } from "../entity-id";
import { requireActiveClip } from "./clip.shared";
import { atOption, frameLayer } from "./footage-frame";

export const CLIP_FRAME_HELP = `A PNG of a Clip as its Video's render shows it, t seconds into the Clip.

  cvm clip frame --at <t> <clip>

The composed frame, at the Video's size. It is drawn by the render's own code
(the Clip's export segment, and one frame of the render's overlay), so what it
shows is what ships, and what the editor's preview shows paused at t. Use it
after 'clip layer add|update' to check a crop, a band or a card.

  A Short (1080x1920), as 'cvm short render' posts it: the Clip's Layers
  bottom to top (its Scene Layer in the Short layout, each Footage Layer's
  Source Crop at its Placement), then the captions and the Chat Cards.

  A Landscape Video (1920x1080), as the course export ships it: the Clip's
  Layers, slid by the Transform of the Overlay on screen at t (a Bullet
  Panel's), then that Definition Card or Bullet Panel. No captions and no
  Chat Cards: the course export draws neither.

<t> is seconds into the Clip (0 is its first frame; its long Pause counts, and
so does the padding after a Video's last Clip). The frame is the one showing
at t, on the render's 60 fps.

Prints { path, clipId, at }: 'path' is a NEW PNG in the temp directory
(cvm-frames/) each time.

THE STILL GATE. It decodes raw footage, so it is refused while any Recording
Session records (or a stopped take is still closing its files): _tag
"StillHeldError", exit 3, "No still while recording: ask again after the Stop".

Refused (exit 3): a t outside the Clip. An unknown or deleted clip is
not-found (exit 2); its Footage offline is exit 4. Local-only (exit 7
elsewhere). A Short's frame runs the overlay renderer (Chromium) once, so it
takes several seconds; so does a Landscape frame with an Overlay on screen.
One with none is a single ffmpeg run.`;

/** The test's fake renderer when one is provided; this machine's otherwise. */
const withOverlayRenderer = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.serviceOption(OverlayFrameService), (given) =>
    Option.isSome(given)
      ? effect.pipe(Effect.provideService(OverlayFrameService, given.value))
      : effect.pipe(Effect.provide(OverlayFrameService.Default))
  );

export const clipFrameCmd = Command.make(
  "frame",
  { clip: entityIdArg("clip"), at: atOption },
  ({ clip, at }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine("cvm clip frame", NEEDS_FOOTAGE_ON_DISK);
      yield* requireActiveClip(clip);
      const png = yield* clipFrame(clip, at).pipe(
        withOverlayRenderer,
        Effect.provide(frameLayer())
      );
      yield* emitObject({ path: png, clipId: clip, at });
    })
).pipe(Command.withDescription(detail(CLIP_FRAME_HELP)));
