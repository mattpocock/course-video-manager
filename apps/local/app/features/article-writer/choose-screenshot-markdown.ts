import {
  applyPreviewRewrites,
  mapPreviewOffset,
  type PreviewRewrite,
} from "./preview-rewrites";

/** Matches the JSX-style tag the writer agent emits. */
const CHOOSE_SCREENSHOT_TAG = /<ChooseScreenshot\s+([^>]*?)\/>/g;

/** Each screenshot placeholder as a rewrite the preview applies. */
export function collectChooseScreenshotRewrites(md: string): PreviewRewrite[] {
  return [...md.matchAll(CHOOSE_SCREENSHOT_TAG)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    replacement: toHtmlTag(match[1] ?? ""),
  }));
}

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
  return applyPreviewRewrites(md, collectChooseScreenshotRewrites(md));
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
  return mapPreviewOffset(collectChooseScreenshotRewrites(md), offset).source;
}
