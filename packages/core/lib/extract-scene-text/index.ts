// Entry point (public) for the extract-scene-text package.
// A deep module: this small surface hides the per-shape parsing, ProseMirror
// traversal, and whitespace normalization in `./lib/impl`.
//
// Extracts flattened, searchable text from a diagram scene's tldraw store.

import { extractShapeText, flattenRichText } from "./lib/impl";

/** Flatten a ProseMirror rich-text doc to plain text. Tolerant of malformed input. */
export { flattenRichText };

/** Extract all shape text from a diagram scene's store, collapsed to a single string. */
export function extractSceneText(scene: unknown): string {
  if (scene === null || scene === undefined || typeof scene !== "object") {
    return "";
  }

  const s = scene as Record<string, unknown>;
  const store = s.store;
  if (store === null || store === undefined || typeof store !== "object") {
    return "";
  }

  const parts: string[] = [];

  for (const record of Object.values(store as Record<string, unknown>)) {
    if (record === null || typeof record !== "object") continue;
    const rec = record as Record<string, unknown>;
    if (rec.typeName !== "shape") continue;

    const text = extractShapeText(rec);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}
