/**
 * Overlay Kind — which content-kind an Overlay carries.
 *
 * An Overlay used to have exactly one content-kind (the Definition Card), so
 * the row carried no discriminator at all. `bulletPanel` is the second, and
 * this is the single place the vocabulary of kinds is written down: the DB
 * column, the `cvm overlay --kind` flag, the Export Hash and (later) the
 * kind-derived camera Transform all read the same list from here rather than
 * each spelling the strings out.
 *
 * Modelled on {@link ./clip-zoom.ts}'s `ClipZoomType`: a string enum with a
 * DEFAULT and a `resolve` coercion, so a raw column value — including the
 * `null`/absent one every Overlay written before this column existed has —
 * lands on the reading that renders what the footage already looked like.
 * Adding a kind is a one-line edit to {@link OVERLAY_KINDS}, which then
 * makes every `Record<OverlayKind, …>` lookup keyed off it a compile error
 * until the new kind is answered for.
 *
 * Overlays are graphics only. B-roll was a Kind until migration 0049 turned
 * every B-roll into Footage Layers (ADR 0056): footage over footage is part of
 * a Clip's picture now (`cvm clip layer`), and a stray row of that Kind would read
 * as the default.
 */

export const OVERLAY_KINDS = [
  "definitionCard",
  "bulletPanel",
  "chatCard",
  "callToAction",
] as const;

export type OverlayKind = (typeof OVERLAY_KINDS)[number];

/**
 * What an Overlay is when nobody said. Existing rows predate the column and
 * every one of them is a Definition Card, so this default is what makes the
 * change additive: no backfill, no behaviour change for existing content.
 */
export const DEFAULT_OVERLAY_KIND: OverlayKind = "definitionCard";

/**
 * Coerce a raw `kind` string (e.g. straight off the DB column) into a known
 * {@link OverlayKind}. Anything unrecognised — including `null` — reads as the
 * default, so an Overlay is never rendered as a kind nothing knows about.
 */
export const resolveOverlayKind = (
  kind: string | null | undefined
): OverlayKind =>
  (OVERLAY_KINDS as readonly string[]).includes(kind ?? "")
    ? (kind as OverlayKind)
    : DEFAULT_OVERLAY_KIND;

/**
 * What each Kind is CALLED — the words GLOSSARY.md uses for it, so a surface
 * naming an Overlay's Kind to the author says "Bullet Panel" and never
 * `bulletPanel`.
 *
 * A `Record<OverlayKind, …>` keyed off {@link OVERLAY_KINDS}, so a new kind
 * is a compile error here until somebody says what to call it.
 */
const OVERLAY_KIND_LABELS: Record<OverlayKind, string> = {
  definitionCard: "Definition Card",
  bulletPanel: "Bullet Panel",
  chatCard: "Chat Card",
  callToAction: "Call to Action",
};

/**
 * The display name of a raw `kind` column, coerced through
 * {@link resolveOverlayKind} like every other reading of it.
 */
export const overlayKindLabel = (kind: string | null | undefined): string =>
  OVERLAY_KIND_LABELS[resolveOverlayKind(kind)];

/**
 * Whether Overlays of these two Kinds may be on screen at the same moment.
 * At most one Overlay is visible at a time (GLOSSARY.md, **Overlay**), with
 * ONE exception: a Call to Action and a Chat Card. On a Short the Chat Card
 * sits at the top and the Call to Action in the lower half, so the two never
 * collide. Two of either may not, and nothing else may share with either.
 *
 * `cvm overlay add`/`update` refuse any other overlap, and the editor's
 * playing preview draws both of the pair, as the Short's render does.
 */
export const overlayKindsMayShareTheScreen = (
  a: OverlayKind,
  b: OverlayKind
): boolean =>
  (a === "callToAction" && b === "chatCard") ||
  (a === "chatCard" && b === "callToAction");
