/**
 * Bullet Panel content — the bullets an Overlay of kind `bulletPanel` carries.
 *
 * A Bullet Panel is a titled list of at most {@link MAX_BULLET_PANEL_BULLETS}
 * lucide-icon bullets shown beside the presenter's face. The Overlay's own
 * `title` column is the panel's heading; the bullets are this module's subject.
 *
 * Each bullet carries its OWN reveal time, in seconds since the Overlay itself
 * started, so an authoring agent can derive it straight from the transcript as
 * `wordStartTime - overlayAt` with no further arithmetic. That is the whole
 * reason the content is authored as a JSON payload rather than as flags: a
 * bullet is three fields that only mean anything together.
 *
 * {@link parseBulletPanelBullets} is the ONE place the payload is validated, so
 * the CLI, the RPC route and any future authoring surface all refuse exactly
 * the same input. It is pure and knows nothing about lucide: the caller injects
 * `isKnownIcon`, which keeps the 400KB vendored icon table out of the domain
 * database package while still failing a typo'd icon name at write time rather
 * than at render time.
 */

/** One bullet: an icon, its line of text, and when it appears. */
export interface BulletPanelBullet {
  /** A lucide icon name, e.g. `"circle-check"`. Validated at write time. */
  icon: string;
  /** The line of text shown beside the icon. */
  text: string;
  /** Seconds after the Overlay's own start at which this bullet appears. */
  revealAt: number;
}

/**
 * Four is what fits the panel's allotted width at a readable size. A fifth
 * bullet is refused rather than shrunk or dropped.
 */
export const MAX_BULLET_PANEL_BULLETS = 4;

/**
 * How long one bullet takes to ease in, and how long the whole panel takes to
 * ease out — the same ~0.35s the Subtitle overlay content and the camera
 * Transform use, so nothing on screen moves at its own private speed. ONE
 * constant because it is one curve used at both ends; the renderer spells it
 * the same way (`BULLET_PANEL_ANIMATION_IN_SECONDS` in
 * `packages/overlay-renderer/src/props.ts`).
 *
 * It is a validation input as well as a render constant — see
 * {@link lastBulletRevealAtInSeconds}.
 */
export const BULLET_PANEL_ANIMATION_IN_SECONDS = 0.35;

/**
 * The latest moment a bullet may be revealed at, for a panel of
 * `durationInSeconds`.
 *
 * A bullet must have FINISHED easing in before the panel STARTS easing out.
 * The panel's exit begins one ease before the window ends, so the room a
 * bullet needs is TWO eases: its own, and the exit it must not collide with.
 *
 * `disableExitAnimation` gives one of those back. A disabled exit is a cut on
 * the final frame — the panel and the camera both hold the shifted framing
 * right to the window's end — so only the bullet's own ease has to fit, and a
 * bullet may be revealed a whole ease later than it otherwise could.
 */
export const lastBulletRevealAtInSeconds = (options: {
  durationInSeconds: number;
  disableExitAnimation?: boolean;
}): number =>
  options.durationInSeconds -
  BULLET_PANEL_ANIMATION_IN_SECONDS * (options.disableExitAnimation ? 1 : 2);

/** Either the validated bullets, or the one message explaining the refusal. */
export type BulletPanelParseResult =
  | { readonly ok: true; readonly bullets: BulletPanelBullet[] }
  | { readonly ok: false; readonly message: string };

const fail = (message: string): BulletPanelParseResult => ({
  ok: false,
  message,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validate a raw `--bullets-json` payload against the Overlay it is being
 * written to.
 *
 * `durationInSeconds` and `disableExitAnimation` are the Overlay's own
 * on-screen length and its exit toggle: together they say how late a bullet
 * may be revealed (see {@link lastBulletRevealAtInSeconds}). `isKnownIcon`
 * answers "is this a real lucide icon name" — see this module's doc comment
 * for why it is injected rather than imported.
 *
 * Every refusal is total: nothing is clamped, reordered or dropped, because an
 * authoring agent that guessed a reveal time wrong needs to be told, not
 * quietly corrected.
 */
export const parseBulletPanelBullets = (
  raw: unknown,
  options: {
    durationInSeconds: number;
    disableExitAnimation?: boolean;
    isKnownIcon: (name: string) => boolean;
  }
): BulletPanelParseResult => {
  if (!Array.isArray(raw)) {
    return fail(
      "--bullets-json must be a JSON array of bullets, each " +
        '{ "icon": string, "text": string, "revealAt": number }'
    );
  }
  if (raw.length === 0) {
    return fail("--bullets-json must contain at least one bullet");
  }
  if (raw.length > MAX_BULLET_PANEL_BULLETS) {
    return fail(
      `--bullets-json has ${raw.length} bullets; a Bullet Panel holds at ` +
        `most ${MAX_BULLET_PANEL_BULLETS}. Split the point across two ` +
        `Overlays instead.`
    );
  }

  const bullets: BulletPanelBullet[] = [];

  for (const [index, entry] of raw.entries()) {
    const at = `bullet ${index + 1}`;
    if (!isRecord(entry)) {
      return fail(`${at} is not an object`);
    }

    const { icon, text, revealAt } = entry;

    if (typeof icon !== "string" || icon.trim() === "") {
      return fail(`${at} needs an "icon" — a lucide icon name`);
    }
    if (!options.isKnownIcon(icon)) {
      return fail(
        `${at}'s icon "${icon}" is not a lucide icon name. Names are ` +
          `kebab-case, e.g. "circle-check" or "triangle-alert".`
      );
    }
    if (typeof text !== "string" || text.trim() === "") {
      return fail(`${at} needs a non-empty "text"`);
    }
    if (typeof revealAt !== "number" || !Number.isFinite(revealAt)) {
      return fail(
        `${at} needs a "revealAt" — seconds after the Overlay's own start`
      );
    }

    bullets.push({ icon, text, revealAt });
  }

  // Shape first, timing second: a bullet with no icon is told about that
  // rather than about a reveal time it does not really have yet.
  return checkBulletPanelBulletsFit(bullets, options);
};

/**
 * Do these bullets still fit the panel they are on?
 *
 * Separate from {@link parseBulletPanelBullets} because the bullets that need
 * checking are not always new ones: SHORTENING an Overlay re-asks this exact
 * question of the bullets already stored on it, and so does turning its exit
 * animation back on. Both are the same refusal in the same words, so both go
 * through here.
 *
 * Every refusal is total: nothing is clamped, reordered or dropped.
 */
export const checkBulletPanelBulletsFit = (
  bullets: ReadonlyArray<BulletPanelBullet>,
  options: {
    durationInSeconds: number;
    disableExitAnimation?: boolean;
  }
): BulletPanelParseResult => {
  const lastRevealAt = lastBulletRevealAtInSeconds(options);
  // The last reveal time accepted so far. Bullets must be submitted in the
  // order they are displayed, so this only ever moves forwards.
  let latestRevealAt = -Infinity;

  for (const [index, bullet] of bullets.entries()) {
    const at = `bullet ${index + 1}`;
    const { revealAt } = bullet;

    if (revealAt < 0) {
      return fail(
        `${at}'s revealAt (${revealAt}) is before the Overlay starts. ` +
          `revealAt is measured from the Overlay's own start, so it is never ` +
          `negative.`
      );
    }
    if (revealAt > lastRevealAt) {
      return fail(
        `${at}'s revealAt (${revealAt}) leaves no room for it to appear ` +
          `before the panel leaves: the Overlay is ` +
          `${options.durationInSeconds}s long, a bullet takes ` +
          `${BULLET_PANEL_ANIMATION_IN_SECONDS}s to ease in` +
          (options.disableExitAnimation
            ? ` and this Overlay's exit is a cut, so the last bullet may be ` +
              `revealed at ${lastRevealAt}s.`
            : ` and the panel spends its last ` +
              `${BULLET_PANEL_ANIMATION_IN_SECONDS}s easing out, so the last ` +
              `bullet may be revealed at ${lastRevealAt}s.`)
      );
    }
    if (revealAt <= latestRevealAt) {
      return fail(
        `${at}'s revealAt (${revealAt}) is not after the bullet above it ` +
          `(${latestRevealAt}). Bullets are revealed one at a time, in the ` +
          `order they are displayed, so each reveal time must be strictly ` +
          `later than the one before it.`
      );
    }

    latestRevealAt = revealAt;
  }

  return { ok: true, bullets: [...bullets] };
};

/**
 * One bullet as a content ADDRESS spells it: the three fields that change what
 * is drawn, under the short keys both hashes have always used.
 *
 * It lives here, next to the type, because two addresses depend on it — the
 * Export Hash (a whole video's bytes) and the Overlay Render Cache's content
 * hash (one `.mov`) — and two independent copies of a hash payload is two
 * addresses that must agree by hand. The keys are load-bearing: changing one
 * moves every cached render and every exported file, so this is a frozen
 * encoding, not a formatting choice.
 */
export const bulletPanelHashPayload = (
  bullets: ReadonlyArray<BulletPanelBullet>
): ReadonlyArray<{ i: string; t: string; r: number }> =>
  bullets.map((bullet) => ({
    i: bullet.icon,
    t: bullet.text,
    r: bullet.revealAt,
  }));
