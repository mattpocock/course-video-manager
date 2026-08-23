import { describe, it, expect } from "vitest";
import {
  BULLET_PANEL_ANIMATION_IN_SECONDS,
  bulletPanelHashPayload,
  checkBulletPanelBulletsFit,
  lastBulletRevealAtInSeconds,
  parseBulletPanelBullets,
  type BulletPanelBullet,
} from "./bullet-panel.js";

/** Every icon name is real, so icon validation never masks a timing refusal. */
const anyIcon = () => true;

const bullet = (revealAt: number): BulletPanelBullet => ({
  icon: "target",
  text: `at ${revealAt}`,
  revealAt,
});

const parse = (
  raw: unknown,
  options: { durationInSeconds: number; disableExitAnimation?: boolean }
) => parseBulletPanelBullets(raw, { ...options, isKnownIcon: anyIcon });

const messageOf = (result: ReturnType<typeof parse>) =>
  result.ok ? "" : result.message;

describe("lastBulletRevealAtInSeconds", () => {
  // The panel's exit BEGINS one ease before the window ends, so a bullet
  // revealed at `duration - 0.35` would be easing IN exactly as the panel eases
  // OUT. The room a bullet needs is its own ease plus the exit it must clear.
  it("reserves TWO eases: the bullet's own, and the panel's exit", () => {
    expect(lastBulletRevealAtInSeconds({ durationInSeconds: 5 })).toBeCloseTo(
      5 - 2 * BULLET_PANEL_ANIMATION_IN_SECONDS
    );
  });

  it("gives one of them back when the exit is a cut", () => {
    expect(
      lastBulletRevealAtInSeconds({
        durationInSeconds: 5,
        disableExitAnimation: true,
      })
    ).toBeCloseTo(5 - BULLET_PANEL_ANIMATION_IN_SECONDS);
  });
});

describe("a bullet must finish appearing before the panel starts leaving", () => {
  // Both bounds are DERIVED, never typed out. The ease is a tuning knob — it
  // is the camera's speed as much as the panel's, see
  // `OVERLAY_TRANSFORM_EASE_IN_SECONDS` — so a test that spells its own
  // arithmetic out in decimals turns every retune into a test edit, and stops
  // saying which rule it is checking.
  const PANEL = 20;
  const EASED_LIMIT = PANEL - 2 * BULLET_PANEL_ANIMATION_IN_SECONDS;
  const CUT_LIMIT = PANEL - BULLET_PANEL_ANIMATION_IN_SECONDS;

  // REGRESSION. The bound used to be one ease before the end, which accepted
  // the precise case it existed to reject: a bullet starting to ease in on the
  // same frame the panel starts easing out.
  it("refuses a bullet revealed as the panel's exit begins", () => {
    const result = parse([bullet(CUT_LIMIT)], { durationInSeconds: PANEL });

    expect(result.ok).toBe(false);
    expect(messageOf(result)).toContain(`${EASED_LIMIT}`);
  });

  it("accepts the last reveal time that does fit", () => {
    expect(parse([bullet(EASED_LIMIT)], { durationInSeconds: PANEL }).ok).toBe(
      true
    );
  });

  it("accepts a whole ease later when the exit is a cut", () => {
    expect(
      parse([bullet(CUT_LIMIT)], {
        durationInSeconds: PANEL,
        disableExitAnimation: true,
      }).ok
    ).toBe(true);
    expect(
      parse([bullet(CUT_LIMIT + 0.05)], {
        durationInSeconds: PANEL,
        disableExitAnimation: true,
      }).ok
    ).toBe(false);
  });

  it("says what the limit is and why", () => {
    const late = PANEL + 1;

    const eased = messageOf(
      parse([bullet(late)], { durationInSeconds: PANEL })
    );
    expect(eased).toContain("easing out");
    expect(eased).toContain(`${EASED_LIMIT}s`);

    const cut = messageOf(
      parse([bullet(late)], {
        durationInSeconds: PANEL,
        disableExitAnimation: true,
      })
    );
    expect(cut).toContain("exit is a cut");
    expect(cut).toContain(`${CUT_LIMIT}s`);
  });
});

describe("bullets are revealed one at a time", () => {
  it("refuses reveal times that go backwards", () => {
    expect(parse([bullet(3), bullet(1)], { durationInSeconds: 20 }).ok).toBe(
      false
    );
  });

  // REGRESSION. Ties used to pass. Two bullets at the same moment arrive in one
  // wave, which is the staggered reveal this feature exists for, undone.
  it("refuses two bullets revealed at the same moment", () => {
    const result = parse([bullet(2), bullet(2)], { durationInSeconds: 20 });

    expect(result.ok).toBe(false);
    expect(messageOf(result)).toContain("strictly later");
  });

  it("accepts strictly ascending reveal times", () => {
    expect(
      parse([bullet(0), bullet(1.5), bullet(3)], { durationInSeconds: 20 }).ok
    ).toBe(true);
  });
});

describe("checkBulletPanelBulletsFit", () => {
  // The same question, asked of bullets that are already stored — which is what
  // `overlay update --duration` has to do before it shortens the window.
  it("re-asks the fit question of bullets that were already accepted", () => {
    const stored = [bullet(0), bullet(4)];

    expect(
      checkBulletPanelBulletsFit(stored, { durationInSeconds: 10 }).ok
    ).toBe(true);
    expect(
      checkBulletPanelBulletsFit(stored, { durationInSeconds: 1 }).ok
    ).toBe(false);
  });

  it("accepts a panel with no bullets at all", () => {
    expect(checkBulletPanelBulletsFit([], { durationInSeconds: 1 }).ok).toBe(
      true
    );
  });
});

describe("bulletPanelHashPayload", () => {
  // The keys are an ADDRESS, shared by the Export Hash and the Overlay Render
  // Cache. Changing one re-addresses every export and every cached render.
  it("is the frozen { i, t, r } encoding both hashes have always used", () => {
    expect(
      bulletPanelHashPayload([
        { icon: "target", text: "Name the problem", revealAt: 0 },
      ])
    ).toEqual([{ i: "target", t: "Name the problem", r: 0 }]);
  });
});
