/** How many paragraphs either side of the tag are sent to the judge. */
export const SURROUNDING_PARAGRAPH_COUNT = 2;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The prose around a `<ChooseScreenshot>` tag, as context for the judge.
 *
 * The `alt` says what should be on screen; the surrounding paragraphs say what
 * the reader has just been told, which disambiguates alts that are true of
 * half the clip ("the terminal output"). Paragraphs are blank-line separated,
 * matching how the writer emits markdown.
 *
 * The tag is located by `clipIndex` *and* `alt` — the same pairing the mutation
 * helpers use — because one document can carry several tags for one clip.
 * Returns "" when the tag isn't found, which is a valid input to the judge.
 */
export function extractSurroundingText(
  markdown: string,
  clipIndex: number,
  alt: string,
  paragraphCount: number = SURROUNDING_PARAGRAPH_COUNT
): string {
  const tag = new RegExp(
    `<ChooseScreenshot\\s+clipIndex=\\{${clipIndex}\\}\\s+alt="${escapeRegex(alt)}"\\s*/>`
  );

  const paragraphs = markdown.split(/\n\s*\n/);
  const tagParagraph = paragraphs.findIndex((p) => tag.test(p));
  if (tagParagraph === -1) return "";

  const start = Math.max(0, tagParagraph - paragraphCount);
  const end = Math.min(paragraphs.length, tagParagraph + paragraphCount + 1);

  return paragraphs
    .slice(start, end)
    .filter((_, i) => start + i !== tagParagraph)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
}
