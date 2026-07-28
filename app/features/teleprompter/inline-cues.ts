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
 * remark has already turned `[docs](url)`, `![alt](url)`, `[ref][1]` and
 * `` `arr[0]` `` into nodes of their own, so the brackets still sitting in a
 * text node are the ones that mean something here.
 */
import type { Parent, PhrasingContent, Root, RootContent } from "mdast";

/** The class the renderer styles cues by — see `script-markdown.tsx`. */
export const CUE_CLASS = "teleprompter-cue";

/**
 * The node the split inserts, carrying `data.hName` — the documented way to
 * hand a custom element to `mdast-util-to-hast`. Registering the type with
 * mdast below is what lets the rest of this file stay honestly typed instead
 * of casting a stranger into the tree.
 */
interface InlineCue extends Parent {
  type: "inlineCue";
  children: PhrasingContent[];
}

declare module "mdast" {
  interface PhrasingContentMap {
    inlineCue: InlineCue;
  }
  interface RootContentMap {
    inlineCue: InlineCue;
  }
}

/** Remark plugin: wraps every inline cue in a span the renderer can style. */
export function remarkInlineCues() {
  return (tree: Root) => {
    splitCues(tree);
  };
}

/**
 * The only nodes whose text is off limits. A link's label belongs to the link,
 * brackets and all. Everything else remark leaves in a text node is fair game:
 * the nodes that quote text verbatim — `inlineCode`, `code`, `image` and the
 * reference forms — are leaves, so there are no children to walk into anyway.
 */
const OPAQUE = new Set(["link", "linkReference"]);

function splitCues(node: Parent): void {
  const next: RootContent[] = [];
  let found = false;

  for (const child of node.children) {
    if (child.type !== "text") {
      if (!OPAQUE.has(child.type) && "children" in child) splitCues(child);
      next.push(child);
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

  if (found) node.children = next;
}

type CueSegment = {
  /** Whether this run is a cue rather than words to speak. */
  cue: boolean;
  /** The run's text. Cues keep their brackets — they're the visual frame. */
  value: string;
};

/** Splits one run of plain text into spoken prose and cues. */
function splitInlineCues(text: string): CueSegment[] {
  const segments: CueSegment[] = [];
  let prose = 0;
  let i = 0;

  while (i < text.length) {
    // A leading `!` makes it an image whose URL never resolved, not a cue.
    if (text[i] !== "[" || text[i - 1] === "!") {
      i++;
      continue;
    }

    const end = cueEnd(text, i);
    // An unclosed `[`, or brackets with nothing in them, is punctuation the
    // reader is speaking around rather than a direction to follow.
    if (end === -1 || !text.slice(i + 1, end).trim()) {
      i++;
      continue;
    }

    if (i > prose) segments.push({ cue: false, value: text.slice(prose, i) });
    segments.push({ cue: true, value: text.slice(i, end + 1) });
    prose = i = end + 1;
  }

  if (prose < text.length) {
    segments.push({ cue: false, value: text.slice(prose) });
  }
  return segments;
}

/**
 * Where the cue opened at `start` closes, or -1 if it never does. Brackets
 * nest, so `[point at [this] thing]` is one direction rather than a small grey
 * `[this]` marooned in two runs of full-size prose.
 */
function cueEnd(text: string, start: number): number {
  let depth = 0;

  for (let i = start; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

function cueNode(value: string): InlineCue {
  return {
    type: "inlineCue",
    data: { hName: "span", hProperties: { className: [CUE_CLASS] } },
    children: [{ type: "text", value }],
  };
}
