/**
 * Turns a Video's Script (one flowing markdown document, per CONTEXT.md) into
 * blocks a teleprompter can move through: headings, paragraphs, lists, and
 * bracketed cues.
 *
 * Splitting is done here rather than by a markdown parser because the crawl
 * needs the blocks as separate nodes — to style them differently, and to measure
 * pace from spoken prose alone. `text` stays as raw markdown; the renderer
 * handles inline formatting from there.
 */

export type ScriptBlock = {
  id: string;
  /**
   * heading = section marker, cue = "[bracketed improv note]", list = bullets
   * or numbered steps, para = verbatim prose.
   */
  kind: "heading" | "para" | "cue" | "list";
  text: string;
  /** Heading depth, 1-6. Only meaningful for kind "heading". */
  level: number;
};

/** A line opening a bullet or numbered list item. */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

export function parseScriptBlocks(script: string): ScriptBlock[] {
  const chunks = script
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter(Boolean);

  return chunks.map((raw, i) => {
    const headingMatch = raw.match(/^(#{1,6})\s+(.*)$/s);
    if (headingMatch) {
      return {
        id: `b${i}`,
        kind: "heading" as const,
        text: headingMatch[2]!.trim(),
        level: headingMatch[1]!.length,
      };
    }
    // A block that is entirely one bracketed note is a cue: something to do,
    // not something to read aloud.
    if (/^\[[\s\S]*\]$/.test(raw)) {
      return {
        id: `b${i}`,
        kind: "cue" as const,
        text: raw.replace(/^\[|\]$/g, "").trim(),
        level: 0,
      };
    }
    // A chunk whose every line opens a list item is a list, and keeps its line
    // breaks — they're the structure, not accidental wrapping.
    const lines = raw.split("\n");
    if (lines.length > 0 && lines.every((line) => LIST_ITEM.test(line))) {
      return { id: `b${i}`, kind: "list" as const, text: raw, level: 0 };
    }
    // Collapse hard-wrapped lines so the reader controls line breaks, not the
    // author's editor width.
    return {
      id: `b${i}`,
      kind: "para" as const,
      text: raw.replace(/\n+/g, " ").replace(/\s{2,}/g, " "),
      level: 0,
    };
  });
}

/**
 * Rough word count, for calibrating the crawl's speed. Markdown syntax is
 * stripped first: `**emphasis**` is one spoken word, and a `-` bullet is none.
 */
export function wordCount(text: string): number {
  return text
    .split("\n")
    .map((line) => line.replace(LIST_ITEM, ""))
    .join(" ")
    .replace(/[*_`~]/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
}
