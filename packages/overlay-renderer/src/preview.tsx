/**
 * The browser-safe half of this package: plain React/Remotion components with
 * no data fetching, no `@remotion/bundler` and no `@remotion/renderer` — safe
 * to pull into a Vite app's client bundle (unlike the `"."` entry point, which
 * drags in Chromium).
 *
 * Exists as its own file, rather than pointing the `"./preview"` export
 * straight at `remotion/DefinitionCard.tsx` and `remotion/BulletPanel.tsx`, so
 * this package's browser-safe surface is one deliberate file instead of
 * "whichever components happen to live in `remotion/` today".
 *
 * Every Overlay Kind the export composites has a `*Preview` here, and that is
 * the contract the editor reads: a Kind with none would preview as untouched
 * footage, and the author would only find out in a render.
 */
import { BulletPanels } from "../remotion/BulletPanel";
import { DefinitionCards } from "../remotion/DefinitionCard";
import type { BulletPanel, DefinitionCard } from "./props";

export { DefinitionCards } from "../remotion/DefinitionCard";
export { BulletPanels } from "../remotion/BulletPanel";
export {
  definitionCardSchema,
  bulletPanelSchema,
  type DefinitionCard,
  type BulletPanel,
  type BulletPanelBullet,
} from "./props";

/**
 * `DefinitionCards` (plural) takes a `cards` array — the render composition's
 * shape, so several cards can share one timeline. A single-card preview (e.g.
 * `@remotion/player`'s `component`, which receives `inputProps` as its own
 * props) has no `cards` array to pass, so this wraps one card in the array
 * `DefinitionCards` expects.
 */
export const DefinitionCardPreview = (props: DefinitionCard) => (
  <DefinitionCards cards={[props]} />
);

/**
 * The same single-item wrapper for a Bullet Panel. At most one Overlay is ever
 * on screen at a time, so the editor never has a second panel to hand either.
 */
export const BulletPanelPreview = (props: BulletPanel) => (
  <BulletPanels panels={[props]} />
);
