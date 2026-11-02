import { existsSync } from "node:fs";
import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import {
  FOOTAGE_LAYER_VOLUME,
  SCENE_LAYER_VOLUME,
  SESSION_FOOTAGE_FILES,
  WHOLE_SOURCE_CROP,
  type ClipLayerSpec,
  type FootageLayerSource,
  type FootageLayerSpec,
  type LayerRect,
} from "@cvm/core/features/videos/clip-layer";
import {
  resolveVideoFormat,
  VIDEO_FORMAT_DIMENSIONS,
} from "@/features/videos/video-format";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { detail, emitNdjson, parseError } from "@/cli/helpers";
import { NEEDS_FOOTAGE_ON_DISK, requireLocalMachine } from "@/cli/local-only";
import { entityIdArg } from "../entity-id";
import { footageOnDisk, footagePathToStore } from "./footage-on-disk";
import { requireActiveClip } from "./clip.shared";
import {
  LAYER_ADD_HELP,
  LAYER_HELP,
  LAYER_LIST_HELP,
  LAYER_MOVE_HELP,
  LAYER_REMOVE_HELP,
  LAYER_UPDATE_HELP,
} from "./clip.layer.help";

/**
 * `cvm clip layer`: a Clip's Layers (ADR 0056), addressed by their index,
 * bottom (0) to top. Each verb reads the Clip's Layers, changes the list and
 * writes it back whole (`setClipLayers`), which judges it against the Clip's
 * Video Format and Recording Session.
 */

const refuse = (message: string) => parseError(message, "clip");

const clipArg = entityIdArg("clip");
const indexArg = Args.integer({ name: "index" });

const footageOpt = Options.text("footage").pipe(
  Options.withDescription(
    "The Footage it draws: a path (root-relative or absolute; local only), or " +
      "'camera' / 'screen' of the Clip's own Recording Session (in sync with the Clip)."
  ),
  Options.optional
);
const fromOpt = Options.float("from").pipe(
  Options.withDescription(
    "Seconds into a Footage file shown at the start of its span (default 0). Not with camera/screen."
  ),
  Options.optional
);
const cropOpt = Options.text("crop").pipe(
  Options.withDescription(
    "Source Crop x,y,w,h as fractions (0-1) of the Footage's frame. Default 0,0,1,1."
  ),
  Options.optional
);
const placeOpt = Options.text("place").pipe(
  Options.withDescription(
    "Placement x,y,w,h in output pixels of the Video's frame. Default: the whole frame."
  ),
  Options.optional
);
const volumeOpt = Options.float("volume").pipe(
  Options.withDescription(
    "0 to 1. A Footage Layer defaults to 0 (muted); the Scene Layer to 1."
  ),
  Options.optional
);
const atOpt = Options.float("at").pipe(
  Options.withDescription(
    "Its span starts this many seconds into the Clip (with --duration). Default: the whole Clip."
  ),
  Options.optional
);
const durationOpt = Options.float("duration").pipe(
  Options.withDescription("Its span lasts this many seconds (with --at)."),
  Options.optional
);

const layerFlags = {
  footage: footageOpt,
  from: fromOpt,
  crop: cropOpt,
  place: placeOpt,
  volume: volumeOpt,
  at: atOpt,
  duration: durationOpt,
};

type LayerFlags = {
  readonly footage: Option.Option<string>;
  readonly from: Option.Option<number>;
  readonly crop: Option.Option<string>;
  readonly place: Option.Option<string>;
  readonly volume: Option.Option<number>;
  readonly at: Option.Option<number>;
  readonly duration: Option.Option<number>;
};

/** `x,y,w,h` as four numbers. */
const parseRect = (flag: string, text: string) =>
  Effect.gen(function* () {
    const parts = text.split(",").map((part) => Number(part.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return yield* refuse(`--${flag} takes x,y,w,h (four numbers): ${text}`);
    }
    const [x, y, w, h] = parts as [number, number, number, number];
    return { x, y, w, h } satisfies LayerRect;
  });

/** A typed `--footage`: the session's file, or a file found on this machine. */
const footageSource = (typed: string, from: number | undefined) =>
  Effect.gen(function* () {
    const sessionFile = SESSION_FOOTAGE_FILES.find((file) => file === typed);
    if (sessionFile) {
      if (from !== undefined) {
        return yield* refuse(
          `--from is for a Footage file; the Recording Session's ${sessionFile} plays on the Clip's own clock`
        );
      }
      return {
        kind: "session",
        file: sessionFile,
      } satisfies FootageLayerSource;
    }
    yield* requireLocalMachine(
      "cvm clip layer --footage <path>",
      NEEDS_FOOTAGE_ON_DISK
    );
    const onDisk = footageOnDisk(typed);
    if (!existsSync(onDisk)) {
      return yield* refuse(`no such Footage on any Storage Root: ${typed}`);
    }
    return {
      kind: "file",
      path: footagePathToStore(typed, onDisk),
      start: from ?? 0,
    } satisfies FootageLayerSource;
  });

const spanFrom = (
  flags: LayerFlags,
  current: FootageLayerSpec["span"]
): Effect.Effect<FootageLayerSpec["span"], unknown> => {
  const at = Option.getOrUndefined(flags.at);
  const duration = Option.getOrUndefined(flags.duration);
  if (at === undefined && duration === undefined)
    return Effect.succeed(current);
  if (at === undefined || duration === undefined) {
    return refuse(
      "--at and --duration go together: the span's start and length"
    );
  }
  return Effect.succeed({ at, duration });
};

/**
 * A Footage Layer from the flags, over `current` (an update) or the
 * defaults: the whole Footage frame over the whole of the Video's frame,
 * muted, for the whole Clip.
 */
const footageLayer = (
  flags: LayerFlags,
  current: FootageLayerSpec | null,
  frame: { width: number; height: number }
) =>
  Effect.gen(function* () {
    const typed = Option.getOrUndefined(flags.footage);
    const from = Option.getOrUndefined(flags.from);
    let source = current?.source;
    if (typed !== undefined) source = yield* footageSource(typed, from);
    else if (from !== undefined && source) {
      if (source.kind === "session") {
        return yield* refuse("--from is for a Footage file, not camera/screen");
      }
      source = { ...source, start: from };
    }
    if (!source) {
      return yield* refuse(
        "a Footage Layer needs --footage <path|camera|screen>"
      );
    }
    const crop = Option.getOrUndefined(flags.crop);
    const place = Option.getOrUndefined(flags.place);
    const layer: FootageLayerSpec = {
      kind: "footage",
      source,
      sourceCrop: crop
        ? yield* parseRect("crop", crop)
        : (current?.sourceCrop ?? WHOLE_SOURCE_CROP),
      placement: place
        ? yield* parseRect("place", place)
        : (current?.placement ?? {
            x: 0,
            y: 0,
            w: frame.width,
            h: frame.height,
          }),
      volume: Option.getOrElse(
        flags.volume,
        () => current?.volume ?? FOOTAGE_LAYER_VOLUME
      ),
      span: yield* spanFrom(flags, current?.span ?? null),
    };
    return layer;
  });

/** A Scene Layer takes only --volume. */
const sceneLayer = (flags: LayerFlags, volume: number) =>
  Effect.gen(function* () {
    const { volume: _volume, ...rest } = flags;
    const others: Option.Option<unknown>[] = Object.values(rest);
    if (others.some(Option.isSome)) {
      return yield* refuse(
        "a Scene Layer takes only --volume: it draws the Clip's own source in its scene layout"
      );
    }
    return {
      kind: "scene",
      volume: Option.getOrElse(flags.volume, () => volume),
    } satisfies ClipLayerSpec;
  });

/** The Clip's Layers and its Video's frame, for a write. */
const loadClip = (clipId: string) =>
  Effect.gen(function* () {
    const row = yield* requireActiveClip(clipId);
    const video = yield* (yield* VideoOperationsService).getVideoWithClipsById(
      row.videoId
    );
    const layers = yield* (yield* ClipOperationsService).listClipLayers(clipId);
    return {
      layers,
      frame: VIDEO_FORMAT_DIMENSIONS[resolveVideoFormat(video.format)],
    };
  });

const emitLayers = (layers: readonly ClipLayerSpec[]) =>
  emitNdjson(layers.map((layer, index) => ({ index, ...layer })));

const write = (clipId: string, layers: readonly ClipLayerSpec[]) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    yield* emitLayers(yield* clipOps.setClipLayers([clipId], layers));
  });

const requireIndex = (layers: readonly ClipLayerSpec[], index: number) =>
  Number.isInteger(index) && index >= 0 && index < layers.length
    ? Effect.succeed(layers[index]!)
    : refuse(
        `no Layer ${index}: the Clip has ${layers.length} (0 to ${layers.length - 1}, bottom to top)`
      );

const listCmd = Command.make("list", { clip: clipArg }, ({ clip }) =>
  Effect.gen(function* () {
    yield* requireActiveClip(clip);
    yield* emitLayers(
      yield* (yield* ClipOperationsService).listClipLayers(clip)
    );
  })
).pipe(Command.withDescription(detail(LAYER_LIST_HELP)));

const addCmd = Command.make(
  "add",
  {
    clip: clipArg,
    scene: Options.boolean("scene").pipe(
      Options.withDescription(
        "Add a Scene Layer (the Clip's own source) instead."
      )
    ),
    ...layerFlags,
  },
  ({ clip, scene, ...flags }) =>
    Effect.gen(function* () {
      const { layers, frame } = yield* loadClip(clip);
      const layer = scene
        ? yield* sceneLayer(flags, SCENE_LAYER_VOLUME)
        : yield* footageLayer(flags, null, frame);
      yield* write(clip, [...layers, layer]);
    })
).pipe(Command.withDescription(detail(LAYER_ADD_HELP)));

const updateCmd = Command.make(
  "update",
  { clip: clipArg, index: indexArg, ...layerFlags },
  ({ clip, index, ...flags }) =>
    Effect.gen(function* () {
      const { layers, frame } = yield* loadClip(clip);
      const current = yield* requireIndex(layers, index);
      const layer =
        current.kind === "scene"
          ? yield* sceneLayer(flags, current.volume)
          : yield* footageLayer(flags, current, frame);
      yield* write(
        clip,
        layers.map((each, i) => (i === index ? layer : each))
      );
    })
).pipe(Command.withDescription(detail(LAYER_UPDATE_HELP)));

const moveCmd = Command.make(
  "move",
  {
    clip: clipArg,
    index: indexArg,
    to: Options.integer("to").pipe(
      Options.withDescription("The index it moves to (0 is the bottom).")
    ),
  },
  ({ clip, index, to }) =>
    Effect.gen(function* () {
      const { layers } = yield* loadClip(clip);
      const layer = yield* requireIndex(layers, index);
      yield* requireIndex(layers, to);
      const rest = layers.filter((_, i) => i !== index);
      yield* write(clip, [...rest.slice(0, to), layer, ...rest.slice(to)]);
    })
).pipe(Command.withDescription(detail(LAYER_MOVE_HELP)));

const removeCmd = Command.make(
  "remove",
  { clip: clipArg, index: indexArg },
  ({ clip, index }) =>
    Effect.gen(function* () {
      const { layers } = yield* loadClip(clip);
      yield* requireIndex(layers, index);
      yield* write(
        clip,
        layers.filter((_, i) => i !== index)
      );
    })
).pipe(Command.withDescription(detail(LAYER_REMOVE_HELP)));

export const clipLayerCommand = Command.make("layer").pipe(
  Command.withDescription(detail(LAYER_HELP)),
  Command.withSubcommands([listCmd, addCmd, updateCmd, moveCmd, removeCmd])
);
