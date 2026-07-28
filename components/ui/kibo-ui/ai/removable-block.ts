import type { Element } from "hast";

/** Source offsets of a rendered block, into the markdown the preview parsed. */
export type BlockRange = { start: number; end: number };

/**
 * Works out whether a rendered block (paragraph, heading, list item) can offer
 * a "remove" control, and where it lives in the markdown source.
 *
 * Returns `undefined` when the node carries no source position — nothing to
 * cut — or when it wraps one of `customTagNames`. A block that only exists to
 * host a custom component (an inline HTML tag with its own `components`
 * override, such as the screenshot picker) is not the user's prose, and that
 * component brings its own controls.
 */
export function getRemovableRange(
  node: Element | undefined,
  customTagNames: ReadonlySet<string>
): BlockRange | undefined {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return undefined;

  const wrapsCustomComponent = node!.children.some(
    (child) => child.type === "element" && customTagNames.has(child.tagName)
  );
  if (wrapsCustomComponent) return undefined;

  return { start, end };
}
