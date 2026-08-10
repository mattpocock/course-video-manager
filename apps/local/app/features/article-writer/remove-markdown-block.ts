/**
 * Removes a single block of markdown — a paragraph, heading or list item —
 * identified by the source offsets react-markdown reports for the rendered
 * element. Offsets must index into the same string the preview parsed; see
 * `mapPreprocessedOffsetToSource` when that string was preprocessed.
 *
 * The blank line (or single newline, inside a tight list) that separated the
 * block from the next one goes with it, so removing a list item does not turn
 * the list loose and removing a paragraph does not leave a gap behind.
 */
export function removeMarkdownBlock(
  markdown: string,
  start: number,
  end: number
): string {
  const sliceStart = lineStartIfOnlyMarkers(markdown, start);

  let sliceEnd = end;
  while (sliceEnd < markdown.length && markdown[sliceEnd] === "\n") {
    sliceEnd++;
  }

  const trailing = markdown.slice(sliceEnd);

  // Nothing but whitespace follows: this was the last block, so the separator
  // to drop is the one *before* it. Keeping a single newline leaves the
  // document with a trailing newline rather than a run of empty lines.
  if (trailing.trim() === "") {
    const leading = markdown.slice(0, sliceStart).replace(/\n+$/, "");
    return leading === "" ? "" : `${leading}\n`;
  }

  return markdown.slice(0, sliceStart) + trailing;
}

/**
 * Pulls `start` back to the beginning of its line when only container markers
 * sit in front of it — the indent that nests a list item, or the `>` that opens
 * a blockquote. A block's reported range begins at its own content, so leaving
 * those behind would re-indent the following item or strand an empty quote.
 */
function lineStartIfOnlyMarkers(markdown: string, start: number): number {
  const lineStart = markdown.lastIndexOf("\n", start - 1) + 1;
  const prefix = markdown.slice(lineStart, start);
  return /^[ \t>]*$/.test(prefix) ? lineStart : start;
}
