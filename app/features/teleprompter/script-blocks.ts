/**
 * Turns a Video's Script (one flowing markdown-ish document, per CONTEXT.md)
 * into blocks a teleprompter can move through: headings, paragraphs, and bracketed
 * cues.
 *
 * Deliberately dumb: no markdown parser, no inline formatting. The Script is
 * written to be spoken, not rendered.
 */

export type ScriptBlock = {
  id: string;
  /** heading = section marker, cue = "[bracketed improv note]", para = verbatim prose. */
  kind: "heading" | "para" | "cue";
  text: string;
  /** Heading depth, 1-6. Only meaningful for kind "heading". */
  level: number;
};

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

/** Rough word count, for calibrating the crawl's speed. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
