/**
 * The browser-safe half of this package: a plain React/Remotion component with
 * no data fetching, no `@remotion/bundler` and no `@remotion/renderer` — safe
 * to pull into a Vite app's client bundle (unlike the `"."` entry point, which
 * drags in Chromium).
 *
 * Exists as its own file, rather than pointing the `"./card"` export straight
 * at `remotion/DefinitionCard.tsx`, so this package's browser-safe surface is
 * one deliberate file instead of "whichever component happens to live in
 * `remotion/` today".
 */
import { DefinitionCards } from "../remotion/DefinitionCard";
import type { DefinitionCard } from "./props";

export { DefinitionCards } from "../remotion/DefinitionCard";
export { definitionCardSchema, type DefinitionCard } from "./props";

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
