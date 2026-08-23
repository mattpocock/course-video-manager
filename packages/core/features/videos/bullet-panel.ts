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
 * How long one bullet takes to ease in — the same ~0.35s the Subtitle overlay
 * content and the camera Transform use, so nothing on screen moves at its own
 * private speed.
 *
 * It is a validation input as well as a render constant: a bullet revealed
 * later than `durationInSeconds - BULLET_ENTER_DURATION_IN_SECONDS` would still
 * be animating in when the whole panel starts animating out, which reads as a
 * flicker rather than as a reveal.
 */
export const BULLET_ENTER_DURATION_IN_SECONDS = 0.35;

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
 * `durationInSeconds` is the Overlay's own on-screen length: every bullet has
 * to be revealed early enough to finish easing in before the panel leaves.
 * `isKnownIcon` answers "is this a real lucide icon name" — see this module's
 * doc comment for why it is injected rather than imported.
 *
 * Every refusal is total: nothing is clamped, reordered or dropped, because an
 * authoring agent that guessed a reveal time wrong needs to be told, not
 * quietly corrected.
 */
export const parseBulletPanelBullets = (
  raw: unknown,
  options: {
    durationInSeconds: number;
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

  // The last reveal time accepted so far. Bullets must be submitted in the
  // order they are displayed, so this only ever moves forwards.
  const latest = { revealAt: -Infinity };
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
    if (revealAt < 0) {
      return fail(
        `${at}'s revealAt (${revealAt}) is before the Overlay starts. ` +
          `revealAt is measured from the Overlay's own start, so it is never ` +
          `negative.`
      );
    }
    const lastRevealAt =
      options.durationInSeconds - BULLET_ENTER_DURATION_IN_SECONDS;
    if (revealAt > lastRevealAt) {
      return fail(
        `${at}'s revealAt (${revealAt}) leaves no room for it to appear: the ` +
          `Overlay is ${options.durationInSeconds}s long and a bullet takes ` +
          `${BULLET_ENTER_DURATION_IN_SECONDS}s to ease in, so the last ` +
          `bullet may be revealed at ${lastRevealAt}s.`
      );
    }
    if (revealAt < latest.revealAt) {
      return fail(
        `${at}'s revealAt (${revealAt}) is before the bullet above it ` +
          `(${latest.revealAt}). Bullets must be submitted in the order they ` +
          `are displayed, so a list never reveals out of order.`
      );
    }

    latest.revealAt = revealAt;
    bullets.push({ icon, text, revealAt });
  }

  return { ok: true, bullets };
};
