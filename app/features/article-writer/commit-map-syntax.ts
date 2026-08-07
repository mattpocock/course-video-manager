/**
 * Reading a commit map out of a lesson body.
 *
 * A commit map is stored verbatim in the AI Hero authoring contract, the same
 * way a quiz is — but it carries no JS object literal, only an HTML attribute
 * and text children. So this file is a scanner and nothing more: there is no
 * `parseObjectLiteral` here, and there should never be one. The preview does
 * not rewrite commit maps either, because `<Commit id="…">` survives the HTML
 * parser intact. See `commit-map-components.tsx`.
 *
 * Everything here reads the *stored* text, not the preview's. The card sees a
 * block the parser already accepted; these functions are what the lint uses to
 * find the blocks it would not accept.
 */

const OPEN_TAG = "<CommitMap>";
const CLOSE_TAG = "</CommitMap>";

/** `<Commit …>`, but never `<CommitMap>` — `\b` refuses the longer name. */
const ENTRY_PATTERN = /<Commit\b([^>]*)>([\s\S]*?)<\/Commit>/g;
const ENTRY_OPEN_PATTERN = /<Commit\b[^>]*>/g;
const ID_ATTRIBUTE = /\bid\s*=\s*"([^"]*)"/;
const BLANK_LINE = /\n[ \t]*\n/;

/** One `<Commit>` inside a map — a commit map entry. */
export interface CommitMapEntry {
  /** The slug the `id` attribute carries, or null when it is missing or empty. */
  id: string | null;
  /** The raw opening tag, so a violation can point the author at the line. */
  openTag: string;
  /** The entry's description, as authored. */
  description: string;
}

export interface CommitMapBlock {
  /** Offset of the `<CommitMap>` that opens the block. */
  start: number;
  /** Offset just past the `</CommitMap>` that closes it. */
  end: number;
  entries: CommitMapEntry[];
  /**
   * A blank line inside the block, which changes how markdown parses it: the
   * children stop arriving as one raw string and gain a paragraph wrapper.
   */
  hasBlankLine: boolean;
}

interface CommitMapScan {
  blocks: CommitMapBlock[];
  /** Offsets of `<CommitMap>` tags that are never closed. */
  unclosedStarts: number[];
}

function parseEntries(inner: string): CommitMapEntry[] {
  const entries: CommitMapEntry[] = [];
  ENTRY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTRY_PATTERN.exec(inner)) !== null) {
    const attributes = match[1] ?? "";
    const id = ID_ATTRIBUTE.exec(attributes)?.[1] ?? "";
    entries.push({
      id: id.length > 0 ? id : null,
      openTag: `<Commit${attributes}>`,
      description: (match[2] ?? "").trim(),
    });
  }
  return entries;
}

/**
 * Every commit map in the text, plus the opening tags that never close.
 *
 * An unclosed block yields no `CommitMapBlock`: half a map has no entries worth
 * reporting on, and the lint that cares about it reads `unclosedStarts`.
 */
export function scanCommitMaps(text: string): CommitMapScan {
  const blocks: CommitMapBlock[] = [];
  const unclosedStarts: number[] = [];

  let at = 0;
  while (true) {
    const start = text.indexOf(OPEN_TAG, at);
    if (start === -1) break;

    const closeAt = text.indexOf(CLOSE_TAG, start + OPEN_TAG.length);
    if (closeAt === -1) {
      unclosedStarts.push(start);
      break;
    }

    const inner = text.slice(start + OPEN_TAG.length, closeAt);
    blocks.push({
      start,
      end: closeAt + CLOSE_TAG.length,
      entries: parseEntries(inner),
      hasBlankLine: BLANK_LINE.test(inner),
    });
    at = closeAt + CLOSE_TAG.length;
  }

  return { blocks, unclosedStarts };
}

/** The commit maps that are whole. */
export function parseCommitMaps(text: string): CommitMapBlock[] {
  return scanCommitMaps(text).blocks;
}

/**
 * The spans a `<Commit>` may legally sit in. An unclosed `<CommitMap>` covers
 * everything after it, so its entries are reported once — as an unclosed block
 * — rather than a second time as entries adrift.
 */
function coveredRanges(scan: CommitMapScan, textLength: number) {
  return [
    ...scan.blocks.map((block) => ({ start: block.start, end: block.end })),
    ...scan.unclosedStarts.map((start) => ({ start, end: textLength })),
  ];
}

/** Entries whose `id` attribute is missing or empty. */
export function findCommitsMissingId(text: string): string[] {
  return parseCommitMaps(text)
    .flatMap((block) => block.entries)
    .filter((entry) => entry.id === null)
    .map((entry) => entry.openTag);
}

/** Ids used more than once across the document's commit maps. */
export function findRepeatedCommitIds(text: string): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const block of parseCommitMaps(text)) {
    for (const entry of block.entries) {
      if (entry.id === null) continue;
      if (seen.has(entry.id)) repeated.add(entry.id);
      seen.add(entry.id);
    }
  }
  return [...repeated];
}

/** `<Commit>` tags that sit outside any `<CommitMap>`. */
export function findCommitsOutsideCommitMap(text: string): string[] {
  const scan = scanCommitMaps(text);
  const covered = coveredRanges(scan, text.length);

  const adrift: string[] = [];
  ENTRY_OPEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTRY_OPEN_PATTERN.exec(text)) !== null) {
    const at = match.index;
    const inside = covered.some((range) => at >= range.start && at < range.end);
    if (!inside) adrift.push(match[0]);
  }
  return adrift;
}

/**
 * `<CommitMap>` tags with no closing tag.
 *
 * This is the worst breach of the lot: aihero.dev compiles a lesson body as
 * real MDX, and an unclosed tag makes the whole body fall back to escaped
 * markdown — every tag in the lesson visible as text. It is also the breach a
 * half-written document always has, which is why its rule never runs while the
 * writer is streaming.
 */
export function findUnclosedCommitMaps(text: string): string[] {
  return scanCommitMaps(text).unclosedStarts.map(() => OPEN_TAG);
}

/** Commit maps broken by a blank line. */
export function findCommitMapsWithBlankLines(text: string): string[] {
  return parseCommitMaps(text)
    .filter((block) => block.hasBlankLine)
    .map(() => OPEN_TAG);
}
