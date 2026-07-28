/**
 * Cues that sit inside a line rather than owning a block of their own.
 *
 * A Script mixes verbatim prose with `[bracketed cues]` (CONTEXT.md) — and the
 * cue is just as often mid-sentence as it is on a line by itself. Both are
 * stage directions: things to do, not words to say. On the glass they need to
 * read as an aside, so the eye skims past them at speed instead of reading them
 * aloud.
 *
 * The split runs over the *parsed* markdown rather than the raw text, which is
 * what makes "brackets that aren't a link or an image" fall out for free:
 * remark has already turned `[docs](url)` and `![alt](url)` into their own
 * nodes, so the brackets left over in a text node are the ones that mean
 * something here.
 */
import type { Nodes, Parent, PhrasingContent, Root } from "mdast";

export type CueSegment = {
  /** Whether this run is a cue rather than words to speak. */
  cue: boolean;
  /** The run's text. Cues keep their brackets — they're the visual frame. */
  value: string;
};

/**
 * A bracketed run, brackets included. Neither bracket may appear inside, so an
 * unclosed `[` swallows nothing and stray brackets stay as prose. A leading `!`
 * is excluded because that's an image whose URL didn't resolve, not a cue.
 */
const CUE = /(?<!!)\[[^[\]]*\]/g;

/** Splits one run of plain text into spoken prose and cues. */
export function splitInlineCues(text: string): CueSegment[] {
  const segments: CueSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CUE)) {
    if (match.index > cursor) {
      segments.push({ cue: false, value: text.slice(cursor, match.index) });
    }
    segments.push({ cue: true, value: match[0] });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ cue: false, value: text.slice(cursor) });
  }
  return segments;
}

/**
 * Nodes whose text isn't prose the reader is free to reinterpret: link and
 * image labels belong to the link, and code is quoted verbatim, so `arr[0]`
 * stays as typed.
 */
const OPAQUE = new Set([
  "code",
  "definition",
  "image",
  "imageReference",
  "inlineCode",
  "link",
  "linkReference",
]);

/** The class the renderer styles cues by — see `script-markdown.tsx`. */
export const CUE_CLASS = "teleprompter-cue";

/**
 * Remark plugin: wraps every inline cue in a span the renderer can style.
 *
 * The wrapper is an unknown mdast node carrying `data.hName`, which is the
 * documented way to hand a custom element to `mdast-util-to-hast` without
 * teaching it a new node type.
 */
export function remarkInlineCues() {
  return (tree: Root) => {
    splitChildren(tree);
  };
}

function splitChildren(node: Nodes): void {
  if (!("children" in node)) return;

  const next: PhrasingContent[] = [];
  let found = false;

  for (const child of (node as Parent).children) {
    if (child.type !== "text") {
      if (!OPAQUE.has(child.type)) splitChildren(child);
      next.push(child as PhrasingContent);
      continue;
    }

    const segments = splitInlineCues(child.value);
    if (!segments.some((segment) => segment.cue)) {
      next.push(child);
      continue;
    }

    found = true;
    for (const segment of segments) {
      next.push(
        segment.cue
          ? cueNode(segment.value)
          : { type: "text", value: segment.value }
      );
    }
  }

  if (found) (node as Parent).children = next;
}

function cueNode(value: string): PhrasingContent {
  return {
    type: "inlineCue",
    data: { hName: "span", hProperties: { className: [CUE_CLASS] } },
    children: [{ type: "text", value }],
  } as unknown as PhrasingContent;
}
