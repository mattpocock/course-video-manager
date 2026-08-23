import { readFileSync } from "node:fs";
import { Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { parseError, type ParseError } from "@/cli/helpers";
import { getIconNode } from "@/packages/lucide-icons";
import {
  checkBulletPanelBulletsFit,
  MAX_BULLET_PANEL_BULLETS,
  parseBulletPanelBullets,
  type BulletPanelBullet,
} from "@/features/videos/bullet-panel";
import type { OverlayKind } from "@/features/videos/overlay-kind";

/**
 * The Bullet Panel half of `cvm overlay add|update` — its options, its
 * `--bullets-json` reader, and the rule that says which content flags go with
 * which `--kind`.
 *
 * Split out of overlay.ts so that module stays under the repo's per-file token
 * budget, and so the whole of "what a bulletPanel Overlay is authored from"
 * reads in one place. The validation itself is NOT here: it lives in
 * `@/features/videos/bullet-panel`, next to the domain type, so the RPC layer
 * and any future authoring surface refuse exactly what this CLI refuses.
 */

/**
 * A tri-state boolean flag: `--flag true`, `--flag false`, or absent.
 *
 * `Options.boolean` cannot say "absent" — it reports a missing flag as `false`,
 * which on `update` would silently clear a toggle the caller never mentioned.
 * Spelling the value out is what makes "leave it alone" expressible.
 */
const toggleOpt = (name: string, description: string) =>
  Options.choice(name, ["true", "false"]).pipe(
    Options.withDescription(description),
    Options.optional
  );

export const bulletsJsonOpt = Options.text("bullets-json").pipe(
  Options.withDescription(
    "Path to a JSON file holding this Bullet Panel's bullets — an array of " +
      `at most ${MAX_BULLET_PANEL_BULLETS} objects, each { "icon", "text", ` +
      '"revealAt" }. "-" reads STDIN. Required with --kind bulletPanel, ' +
      "refused with --kind definitionCard."
  ),
  Options.optional
);

export const disableEnterAnimationOpt = toggleOpt(
  "disable-enter-animation",
  "true = hard-cut INTO the Overlay: the panel and the camera move both " +
    "appear at once instead of easing in. Bullets still appear at their own " +
    "revealAt. Omitted on 'add' means false."
);

export const disableExitAnimationOpt = toggleOpt(
  "disable-exit-animation",
  "true = hard-cut OUT of the Overlay: the panel and the camera move both " +
    "vanish at once instead of easing out. Omitted on 'add' means false."
);

/** `"true"`/`"false"`/absent as the boolean the DB column takes. */
const toggleValue = (raw: "true" | "false" | undefined): boolean | undefined =>
  raw === undefined ? undefined : raw === "true";

/**
 * The Bullet Panel flags, as `add` and `update` both take them. Spread into
 * `Command.make`'s config so the two verbs cannot drift apart.
 */
export const bulletPanelOpts = {
  bulletsJson: bulletsJsonOpt,
  disableEnterAnimation: disableEnterAnimationOpt,
  disableExitAnimation: disableExitAnimationOpt,
};

/** Those same flags as the handler receives them. */
export type BulletPanelFlags = {
  bulletsJson: Option.Option<string>;
  disableEnterAnimation: Option.Option<"true" | "false">;
  disableExitAnimation: Option.Option<"true" | "false">;
};

/** Did the caller mention any of them? `update` refuses a no-op patch. */
export const hasBulletPanelFlags = (flags: BulletPanelFlags): boolean =>
  Option.isSome(flags.bulletsJson) ||
  Option.isSome(flags.disableEnterAnimation) ||
  Option.isSome(flags.disableExitAnimation);

/**
 * Read text from a file path, or from STDIN when the path is '-'. An unreadable
 * source is invalid input (exit 3), matching this CLI's treatment of every
 * other bad flag value. Mirrors `video.ts`'s reader for `--body-file`.
 */
const readFileSource = (source: string) =>
  Effect.try({
    try: () => readFileSync(source === "-" ? 0 : source, "utf8"),
    catch: () =>
      parseError(
        `could not read --bullets-json ${
          source === "-" ? "(stdin)" : `"${source}"`
        }`,
        "overlay"
      ),
  });

/**
 * Read and validate a `--bullets-json <path|->` payload for an Overlay of
 * `durationInSeconds`.
 *
 * The window is a validation input, not decoration: a bullet revealed too near
 * the end would still be easing in as the panel starts leaving, so it is
 * refused here rather than discovered in a render. Both halves of the window
 * matter — the exit toggle buys a bullet one more ease of room, because a cut
 * exit begins at the very end instead of one ease before it.
 */
export const readBulletsJson = (
  source: string,
  window: { durationInSeconds: number; disableExitAnimation: boolean }
): Effect.Effect<BulletPanelBullet[], ParseError> =>
  Effect.gen(function* () {
    const text = yield* readFileSource(source);
    const raw = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () =>
        parseError(
          `--bullets-json ${
            source === "-" ? "(stdin)" : `"${source}"`
          } is not valid JSON`,
          "overlay"
        ),
    });
    const parsed = parseBulletPanelBullets(raw, {
      durationInSeconds: window.durationInSeconds,
      disableExitAnimation: window.disableExitAnimation,
      // The vendored lucide table is the same one the diagram palette draws
      // from, so a name that works there works here — and a typo fails now
      // rather than rendering as a blank square.
      isKnownIcon: (name) => getIconNode(name) !== undefined,
    });
    if (!parsed.ok) {
      return yield* parseError(parsed.message, "overlay");
    }
    return parsed.bullets;
  });

/**
 * Each content-kind owns its own content flags, and passing the other kind's is
 * refused rather than ignored: an Overlay whose `--description` was silently
 * dropped renders as a panel the author never proof-read.
 *
 * `needsContent` says whether the content flag is REQUIRED — true when the row
 * is being created, or when `--kind` is changing it into a kind whose content
 * it does not have yet.
 */
export const requireContentForKind = (params: {
  kind: OverlayKind;
  needsContent: boolean;
  description: string | undefined;
  bulletsJson: string | undefined;
}) => {
  if (params.kind === "bulletPanel") {
    if (params.description !== undefined) {
      return parseError(
        "--description is Definition Card content; a bulletPanel Overlay's " +
          "content is --title (the panel heading) plus --bullets-json",
        "overlay"
      );
    }
    if (params.needsContent && params.bulletsJson === undefined) {
      return parseError(
        "--kind bulletPanel needs --bullets-json <path|-> — the panel's " +
          "bullets",
        "overlay"
      );
    }
    return Effect.void;
  }

  if (params.bulletsJson !== undefined) {
    return parseError(
      "--bullets-json is Bullet Panel content; pass --kind bulletPanel to " +
        "author one",
      "overlay"
    );
  }
  if (params.needsContent && params.description === undefined) {
    return parseError(
      "--description is required for a definitionCard Overlay — the " +
        "definition itself",
      "overlay"
    );
  }
  return Effect.void;
};

/**
 * The Bullet Panel half of a create or a patch: the flags read, validated
 * against the kind the Overlay will BE, and turned into the columns the write
 * takes. `undefined` means "the caller did not say", which on a patch leaves
 * the column alone.
 *
 * `needsContent` is true when the row has no content of this kind yet — on a
 * create, or when `--kind` is changing it.
 */
export const resolveBulletPanelPatch = (params: {
  kind: OverlayKind;
  needsContent: boolean;
  durationInSeconds: number;
  /** The stored toggle a patch leaves alone. Absent on a create: `add` starts
   * from an eased exit, so an unmentioned flag means `false`. */
  currentDisableExitAnimation?: boolean;
  description: string | undefined;
  flags: BulletPanelFlags;
}) =>
  Effect.gen(function* () {
    const bulletsJson = Option.getOrUndefined(params.flags.bulletsJson);
    yield* requireContentForKind({
      kind: params.kind,
      needsContent: params.needsContent,
      description: params.description,
      bulletsJson,
    });
    const disableExitAnimation = toggleValue(
      Option.getOrUndefined(params.flags.disableExitAnimation)
    );
    return {
      // Read only after the kind has accepted the flag, so the complaint the
      // caller sees is the first thing actually wrong. The bullets are checked
      // against the window this write LEAVES BEHIND — the new duration, and
      // whichever exit toggle survives it.
      bullets:
        bulletsJson === undefined
          ? undefined
          : yield* readBulletsJson(bulletsJson, {
              durationInSeconds: params.durationInSeconds,
              disableExitAnimation:
                disableExitAnimation ??
                params.currentDisableExitAnimation ??
                false,
            }),
      disableEnterAnimation: toggleValue(
        Option.getOrUndefined(params.flags.disableEnterAnimation)
      ),
      disableExitAnimation,
    };
  });

/**
 * Re-ask the fit question of the bullets a Bullet Panel ALREADY carries.
 *
 * `overlay update --duration 1` on a panel whose last bullet is revealed at 4s
 * is the same mistake as authoring that bullet in the first place, and gets the
 * same refusal rather than a silently clipped reveal. Nothing is clamped: the
 * stored reveal times are the author's, and only the author can retime them.
 */
export const requireStoredBulletsStillFit = (params: {
  bullets: ReadonlyArray<BulletPanelBullet>;
  durationInSeconds: number;
  disableExitAnimation: boolean;
}) => {
  const checked = checkBulletPanelBulletsFit(params.bullets, {
    durationInSeconds: params.durationInSeconds,
    disableExitAnimation: params.disableExitAnimation,
  });
  return checked.ok
    ? Effect.void
    : parseError(
        `${checked.message} These are the bullets already stored on this ` +
          `Overlay — pass --bullets-json with reveal times that fit the new ` +
          `window, or leave the window as it was.`,
        "overlay"
      );
};
