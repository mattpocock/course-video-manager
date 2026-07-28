/** Matches the JSX-style tag the writer agent emits. */
const CHOOSE_SCREENSHOT_TAG = /<ChooseScreenshot\s+([^>]*?)\/>/g;

function toHtmlTag(attrs: string): string {
  const htmlAttrs = attrs
    .replace(/=\{([^}]+)\}/g, '="$1"')
    .replace(
      /([a-zA-Z]+)=/g,
      (_m: string, name: string) => `${name.toLowerCase()}=`
    )
    .trim();
  return `<choosescreenshot ${htmlAttrs}></choosescreenshot>`;
}

/**
 * Pre-processes AI-generated markdown to convert JSX-style ChooseScreenshot
 * tags into HTML-compatible syntax that rehype-raw can parse.
 *
 * Converts: <ChooseScreenshot clipIndex={1} alt="test" />
 * Into:     <choosescreenshot clipindex="1" alt="test"></choosescreenshot>
 */
export function preprocessChooseScreenshotMarkdown(md: string): string {
  return md.replace(CHOOSE_SCREENSHOT_TAG, (_match, attrs: string) =>
    toHtmlTag(attrs)
  );
}

/**
 * Translates an offset in `preprocessChooseScreenshotMarkdown(md)` back to the
 * matching offset in `md`.
 *
 * The preview parses the preprocessed string, so the source positions
 * react-markdown hands back are shifted by every screenshot tag rewritten
 * ahead of them — mutating the stored document at those raw offsets would cut
 * the wrong text. Returns `offset` untouched when the document has no
 * screenshot tags, which is the common case.
 */
export function mapPreprocessedOffsetToSource(
  md: string,
  offset: number
): number {
  let shift = 0;
  for (const match of md.matchAll(CHOOSE_SCREENSHOT_TAG)) {
    const sourceLength = match[0].length;
    const renderedLength = toHtmlTag(match[1] ?? "").length;
    const renderedStart = match.index + shift;
    // The offset falls before or inside this tag — no further shift applies.
    if (renderedStart + renderedLength > offset) break;
    shift += renderedLength - sourceLength;
  }
  return offset - shift;
}
