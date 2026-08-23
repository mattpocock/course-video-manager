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
 * Adding a third kind is a one-line edit to {@link OVERLAY_KINDS}, which then
 * makes every `Record<OverlayKind, …>` lookup keyed off it a compile error
 * until the new kind is answered for.
 */

export const OVERLAY_KINDS = ["definitionCard", "bulletPanel"] as const;

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
 * What each Kind is CALLED — the words CONTEXT.md uses for it, so a surface
 * naming an Overlay's Kind to the author says "Bullet Panel" and never
 * `bulletPanel`.
 *
 * A `Record<OverlayKind, …>` keyed off {@link OVERLAY_KINDS}, so a third kind
 * is a compile error here until somebody says what to call it.
 */
const OVERLAY_KIND_LABELS: Record<OverlayKind, string> = {
  definitionCard: "Definition Card",
  bulletPanel: "Bullet Panel",
};

/**
 * The display name of a raw `kind` column, coerced through
 * {@link resolveOverlayKind} like every other reading of it.
 */
export const overlayKindLabel = (kind: string | null | undefined): string =>
  OVERLAY_KIND_LABELS[resolveOverlayKind(kind)];
