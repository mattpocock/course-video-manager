/**
 * Addresses inside plain text, made clickable.
 *
 * The Script is markdown, so there a link is remark's job (see
 * `script-markdown.tsx`). A Beat Description isn't — it's a free-text planning
 * note, plain everywhere else in the app — and a note that says "show
 * https://…" is exactly the thing you want to open mid-take rather than read
 * out. So the glass finds the address itself.
 *
 * Deliberately conservative about what counts: a protocol, or a leading `www.`.
 * A course script is full of `index.ts` and `app/root.tsx`, and a bare-domain
 * rule would turn every filename on the glass blue.
 */
import { TYPE, linkStyle } from "./teleprompter-settings";

/**
 * How much of an address survives on the glass. The measure is the budget: an
 * address that alone runs past a line of it costs more than the words around
 * it, and nobody reads a URL off a teleprompter — they click it. Only the label
 * is cut; the address it points at is whole.
 */
const MAX_URL_CHARS = TYPE.measure;

/** An address starts a word, and ends where whitespace or a bracket does. */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>[\]()]+/gi;
/** Sentence punctuation the address ran into, which was never part of it. */
const TRAILING_PUNCTUATION = /[.,;:!?'"…]+$/;

/**
 * The address as it reads on the glass — see `MAX_URL_CHARS`. The protocol, a
 * leading `www.` and a trailing slash all go: none of them is ever spoken, and
 * together they're a third of a very short line.
 */
export function shortenUrl(url: string): string {
  const bare = url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
  return bare.length <= MAX_URL_CHARS
    ? bare
    : `${bare.slice(0, MAX_URL_CHARS - 1)}…`;
}

type Piece = string | { url: string; href: string };

/** Splits a note into the words and the addresses hiding among them. */
function splitLinks(text: string): Piece[] {
  const pieces: Piece[] = [];
  let prose = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    if (start > prose) pieces.push(text.slice(prose, start));
    pieces.push({
      url,
      // A `www.` address with no protocol means https; the http GFM writes for
      // the same shape is a holdover from when that wasn't true.
      href: url.startsWith("www.") ? `https://${url}` : url,
    });
    prose = start + url.length;
  }

  if (prose < text.length) pieces.push(text.slice(prose));
  return pieces;
}

export function LinkedText(props: { children: string }) {
  return (
    <>
      {splitLinks(props.children).map((piece, i) =>
        typeof piece === "string" ? (
          piece
        ) : (
          <a
            key={i}
            href={piece.href}
            target="_blank"
            rel="noreferrer"
            style={linkStyle()}
          >
            {shortenUrl(piece.url)}
          </a>
        )
      )}
    </>
  );
}
