import { existsSync } from "node:fs";
import { Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { notFound, parseError } from "@/cli/helpers";
import { NEEDS_FOOTAGE_ON_DISK, requireLocalMachine } from "@/cli/local-only";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { FootageProbe, probeWithFfprobe } from "@/services/footage-probe";
import { isImportedFootage } from "@/packages/storage";
import type { OverlayKind } from "@/features/videos/overlay-kind";
import { resolveVideoFormat } from "@/features/videos/video-format";
import { footageOnDisk, footagePathToStore } from "./footage-on-disk";
import { hasBulletPanelFlags, type BulletPanelFlags } from "./overlay.bullets";

/**
 * The B-roll half of `cvm overlay add|update`: its two flags, the rule that
 * says which flags go with `--kind bRoll`, and the checks against the Video
 * and the Imported Footage file that a B-roll's columns must pass.
 *
 * Split out of overlay.ts so that module stays under the repo's per-file token
 * budget, as `overlay.bullets.ts` holds the Bullet Panel's.
 */

export const bRollOpts = {
  footage: Options.text("footage").pipe(
    Options.withDescription(
      "A B-roll's Imported Footage: a path under raw-footage/imported/, " +
        "root-relative or absolute. Only with --kind bRoll."
    ),
    Options.optional
  ),
  from: Options.float("from").pipe(
    Options.withDescription(
      "Seconds into the B-roll's Footage where its picture starts (>= 0; " +
        "--from + --duration must be inside the file). Only with --kind bRoll."
    ),
    Options.optional
  ),
};

export type BRollFlags = {
  footage: Option.Option<string>;
  from: Option.Option<number>;
};

export const hasBRollFlags = (flags: BRollFlags): boolean =>
  Option.isSome(flags.footage) || Option.isSome(flags.from);

const refuse = (message: string) => parseError(message, "overlay");

/**
 * Which flags go with the kind the Overlay will BE. A B-roll carries no
 * title, description, bullets or Animation Toggles: it cuts in and out, and
 * its content is its Footage. Every other kind refuses the B-roll's flags,
 * and needs a `--title` when it has none yet (`needsTitle`).
 *
 * A B-roll reads its Footage off this machine's disk, so it is local-only,
 * and that is asked first.
 */
export const requireFlagsForKind = (params: {
  kind: OverlayKind;
  needsTitle: boolean;
  title: string | undefined;
  description: string | undefined;
  bulletPanel: BulletPanelFlags;
  bRoll: BRollFlags;
}) =>
  Effect.gen(function* () {
    if (params.kind !== "bRoll") {
      if (hasBRollFlags(params.bRoll)) {
        return yield* refuse(
          "--footage and --from are B-roll content; pass --kind bRoll to " +
            "author one"
        );
      }
      if (params.needsTitle && params.title === undefined) {
        return yield* refuse(
          `--title is required for a ${params.kind} Overlay`
        );
      }
      return;
    }
    yield* requireLocalMachine(
      "cvm overlay --kind bRoll",
      NEEDS_FOOTAGE_ON_DISK
    );
    if (
      params.title !== undefined ||
      params.description !== undefined ||
      hasBulletPanelFlags(params.bulletPanel)
    ) {
      return yield* refuse(
        "a bRoll Overlay takes no --title, --description, --bullets-json or " +
          "Animation Toggle: its content is --footage and --from, and it " +
          "always cuts in and out"
      );
    }
  });

/** How long the file is, by the probe a test can answer for. */
const probeLength = (file: string) =>
  Effect.gen(function* () {
    const prober = yield* Effect.serviceOption(FootageProbe);
    const probe = yield* Option.match(prober, {
      onSome: (p) => p.probe(file),
      onNone: () => probeWithFfprobe(file),
    }).pipe(
      Effect.catchTag("FootageUnreadableError", (e) =>
        refuse(`ffprobe can't read the B-roll's Footage ${file} (${e.message})`)
      )
    );
    return probe.durationSeconds;
  });

/**
 * The B-roll columns this write leaves behind: null for every other kind,
 * and for a B-roll its Footage (root-relative) and `from`, each from the
 * flags or else from what is `current`ly stored, checked against the Video
 * (never a Short) and the file (Imported Footage, found, and long enough to
 * cover `from` + the Overlay's duration).
 */
export const resolveBRollColumns = (params: {
  kind: OverlayKind;
  videoId: string;
  durationInSeconds: number;
  current: { footagePath: string | null; footageStart: number | null } | null;
  flags: BRollFlags;
}) =>
  Effect.gen(function* () {
    if (params.kind !== "bRoll")
      return { footagePath: null, footageStart: null };

    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps
      .getVideoWithClipsById(params.videoId)
      .pipe(
        Effect.catchTag("NotFoundError", () =>
          notFound("video", params.videoId)
        )
      );
    if (resolveVideoFormat(video.format) === "short") {
      return yield* refuse(
        `Video ${params.videoId} is a Short, and a B-roll's 16:9 picture is ` +
          "never put over a vertical frame"
      );
    }

    const typed =
      Option.getOrUndefined(params.flags.footage) ??
      params.current?.footagePath ??
      undefined;
    const from =
      Option.getOrUndefined(params.flags.from) ??
      params.current?.footageStart ??
      undefined;
    if (typed === undefined || from === undefined) {
      return yield* refuse(
        "--kind bRoll needs --footage <path> and --from <s>: the Imported " +
          "Footage and where in it the picture starts"
      );
    }
    if (from < 0) {
      return yield* refuse(`--from (${from}) must be at or after 0`);
    }

    const onDisk = footageOnDisk(typed);
    if (!existsSync(onDisk)) {
      return yield* refuse(`no such Footage on any Storage Root: ${typed}`);
    }
    const stored = footagePathToStore(typed, onDisk);
    if (!isImportedFootage(stored)) {
      return yield* refuse(
        `${typed} is not Imported Footage: a B-roll's Footage is a file under ` +
          "raw-footage/imported/ on a Storage Root (import it with " +
          "'cvm footage import')"
      );
    }

    const length = yield* probeLength(onDisk);
    if (from + params.durationInSeconds > length) {
      return yield* refuse(
        `--from (${from}) + --duration (${params.durationInSeconds}) runs ` +
          `past the end of ${stored}, which is ${length}s long`
      );
    }
    return { footagePath: stored, footageStart: from };
  });
