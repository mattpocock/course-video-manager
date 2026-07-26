/**
 * PROTOTYPE — throwaway.
 *
 * Turns a Video's Script (one flowing markdown-ish document, per CONTEXT.md)
 * into units a teleprompter can move through. Two granularities, because the
 * variants disagree about what a "step" is:
 *
 *   - Blocks: headings, paragraphs, and bracketed cues. What you *see*.
 *   - Steps:  the unit a Stream Deck press advances by. Paragraphs get split
 *             into sentence groups so a long paragraph isn't one giant jump.
 *
 * Deliberately dumb: no markdown parser, no inline formatting. If the prototype
 * says the chunking is wrong, that's a finding, not a bug to fix here.
 */

export type ScriptBlock = {
  id: string;
  /** heading = section marker, cue = "[bracketed improv note]", para = verbatim prose. */
  kind: "heading" | "para" | "cue";
  text: string;
  /** Heading depth, 1-6. Only meaningful for kind "heading". */
  level: number;
};

export type ScriptStep = {
  id: string;
  blockId: string;
  kind: ScriptBlock["kind"];
  text: string;
};

/** Sentence groups longer than this get their own step. */
const STEP_TARGET_CHARS = 180;

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

export function splitIntoSteps(blocks: ScriptBlock[]): ScriptStep[] {
  const steps: ScriptStep[] = [];

  for (const block of blocks) {
    if (block.kind !== "para") {
      steps.push({
        id: `${block.id}-0`,
        blockId: block.id,
        kind: block.kind,
        text: block.text,
      });
      continue;
    }

    const sentences = block.text.split(/(?<=[.!?…])\s+/).filter(Boolean);
    let buffer: string[] = [];
    let n = 0;
    const flush = () => {
      if (!buffer.length) return;
      steps.push({
        id: `${block.id}-${n++}`,
        blockId: block.id,
        kind: "para",
        text: buffer.join(" "),
      });
      buffer = [];
    };

    for (const sentence of sentences) {
      buffer.push(sentence);
      if (buffer.join(" ").length >= STEP_TARGET_CHARS) flush();
    }
    flush();
  }

  return steps;
}

/** Rough read time, for the crawl variant's speed dial and the progress read-out. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
