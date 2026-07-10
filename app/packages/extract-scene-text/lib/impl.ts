// Internal implementation for the extract-scene-text package.
// Hidden in a subfolder — reach it only through the package entry point (`../index`).

const RICH_TEXT_SHAPE_TYPES = new Set(["text", "geo", "note", "arrow"]);

export function flattenRichText(richText: unknown): string {
  if (
    richText === null ||
    richText === undefined ||
    typeof richText !== "object"
  ) {
    return "";
  }

  const rt = richText as Record<string, unknown>;
  const content = rt.content;
  if (!Array.isArray(content)) return "";

  const blockTexts: string[] = [];

  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const blockObj = block as Record<string, unknown>;
    const innerContent = blockObj.content;
    if (!Array.isArray(innerContent)) continue;

    let blockText = "";
    for (const leaf of innerContent) {
      if (leaf === null || typeof leaf !== "object") continue;
      const leafObj = leaf as Record<string, unknown>;
      if (leafObj.type === "text" && typeof leafObj.text === "string") {
        blockText += leafObj.text;
      }
    }
    if (blockText) {
      blockTexts.push(blockText);
    }
  }

  const joined = blockTexts.join(" ");
  return joined.replace(/\s+/g, " ").trim();
}

export function extractShapeText(shape: Record<string, unknown>): string {
  const type = shape.type;
  if (typeof type !== "string") return "";

  const props = shape.props;
  if (props === null || props === undefined || typeof props !== "object") {
    return "";
  }
  const p = props as Record<string, unknown>;

  if (type === "frame") {
    return typeof p.name === "string" ? p.name.replace(/\s+/g, " ").trim() : "";
  }

  if (!RICH_TEXT_SHAPE_TYPES.has(type)) return "";

  if (p.richText !== undefined && p.richText !== null) {
    return flattenRichText(p.richText);
  }

  if (typeof p.text === "string") {
    return p.text.replace(/\s+/g, " ").trim();
  }

  return "";
}
