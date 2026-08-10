import type { TLAnyShapeUtilConstructor } from "tldraw";
import { CvmIconShapeUtil } from "./cvm-icon-shape";

/**
 * THE ONE PLACE CVM's custom shape utils are named.
 *
 * An unregistered shape type fails schema validation with a throw that kills
 * the ENTIRE document load, not just the offending shape. Registration is
 * therefore a hard precondition for creation, and every surface that renders a
 * diagram has to be handed this array.
 *
 * There are exactly two such surfaces:
 *   1. the `<Tldraw>` in the diagram playground route, and
 *   2. the `<TldrawImage>` inside `DiagramThumbnail`.
 *
 * (2) is the live hazard: it is the fallback whenever no cached PNG exists, so
 * without it the first diagram containing an icon would throw while rendering
 * its own Playground Home / timeline / clip-item thumbnail. Cached PNGs were
 * never at risk — `render-thumbnail.ts` runs inside the playground editor.
 *
 * Add a new custom shape here and nowhere else, and ship the registration in a
 * build BEFORE anything can create one.
 */
export const CVM_SHAPE_UTILS: readonly TLAnyShapeUtilConstructor[] = [
  CvmIconShapeUtil,
];
