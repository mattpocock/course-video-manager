/**
 * Addresses on the glass — found in plain text, and rendered wherever one turns
 * up.
 *
 * The Script is markdown, so there *finding* a link is remark's job (see
 * `script-markdown.tsx`). A Beat Description isn't — it's a free-text planning
 * note, plain everywhere else in the app — and a note that says "show
 * https://…" is exactly the thing you want to open mid-take rather than read
 * out. So the glass finds the address itself.
 *
 * Deliberately conservative about what counts: a protocol, or a leading `www.`.
 * A course script is full of `index.ts` and `app/root.tsx`, and a bare-domain
 * rule would turn every filename on the glass blue.
 *
 * Both surfaces render through `GlassLink`, so however a link was found it
 * looks and behaves the same once it's on the glass.
 */
import type { ReactNode } from "react";
import { TYPE, linkStyle } from "./teleprompter-settings";

/**
 * How much of an address survives on the glass. The measure is the budget: an
 * address that alone runs past a line of it costs more than the words around
 * it, and nobody reads a URL off a teleprompter — they click it. Only the label
 * is cut; the address it points at is whole.
 *
 * The Script's measure, not the wider one Beats use: a label cut to fit the
 * narrower surface fits both, and an address reads the same wherever it's
 * quoted.
 */
const MAX_URL_CHARS = TYPE.measure;

/**
 * An address starts a word and runs to whitespace or a bracket. Parentheses are
 * *not* a boundary — plenty of real addresses contain a balanced pair
 * (`…/wiki/Trie_(data_structure)`), and stopping at the first `(` would point
 * the link at a page that doesn't exist. The unbalanced closer that ends
 * "(see https://…)" is trimmed off afterwards instead.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>[\]]+/gi;
/** Sentence punctuation the address ran into, which was never part of it. */
const TRAILING_PUNCTUATION = /[.,;:!?'"…]+$/;
/** The scheme, where the address was written with one. */
const PROTOCOL = /^https?:\/\//i;

/**
 * The address with the parts nobody ever says stripped off — the protocol, a
 * leading `www.`, a trailing slash. Together they're a third of a very short
 * line. Empty when that's all there was, which is how "type https:// to start"
 * is told apart from an actual address.
 */
function bareAddress(url: string): string {
  return url
    .replace(PROTOCOL, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

/** The address as it reads on the glass — see `MAX_URL_CHARS`. */
export function shortenUrl(url: string): string {
  const bare = bareAddress(url);
  return bare.length <= MAX_URL_CHARS
    ? bare
    : `${bare.slice(0, MAX_URL_CHARS - 1)}…`;
}

/**
 * The sentence's punctuation, peeled off the end of an address that ran into
 * it. A closing paren only counts as the sentence's when the address hasn't got
 * an opener to match it, so "(see https://x.com/a)" loses its bracket while
 * "https://x.com/Trie_(data)" keeps both of its own.
 */
function trimSentence(url: string): string {
  let trimmed = url.replace(TRAILING_PUNCTUATION, "");
  while (trimmed.endsWith(")") && !hasMatchingOpener(trimmed)) {
    trimmed = trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  }
  return trimmed;
}

function hasMatchingOpener(url: string): boolean {
  const opened = url.split("(").length;
  const closed = url.split(")").length;
  return opened >= closed;
}

type Piece = string | { url: string; href: string };

/** Splits a note into the words and the addresses hiding among them. */
function splitLinks(text: string): Piece[] {
  const pieces: Piece[] = [];
  let prose = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimSentence(match[0]);
    // All prefix and no address — "type https:// to start" is a line to read
    // out, not somewhere to send anyone.
    if (!bareAddress(url)) continue;

    if (match.index > prose) pieces.push(text.slice(prose, match.index));
    pieces.push({
      url,
      // Only a `www.` address reaches here without a scheme, and it means
      // https — the http GFM writes for the same shape is a holdover from when
      // that wasn't true. It has to gain one either way: an href with no scheme
      // is a path, and the browser would resolve it against the teleprompter
      // and navigate the glass away rather than open anything.
      href: PROTOCOL.test(url) ? url : `https://${url}`,
    });
    prose = match.index + url.length;
  }

  if (prose < text.length) pieces.push(text.slice(prose));
  return pieces;
}

/**
 * A link on the glass. Links are the one thing here worth clicking: mid-take
 * you open the page you're about to demo rather than read its address out. A
 * new window, always — the teleprompter must still be on the glass when you
 * come back.
 */
export function GlassLink(props: {
  href: string | undefined;
  children: ReactNode;
}) {
  return (
    <a href={props.href} target="_blank" rel="noreferrer" style={linkStyle()}>
      {props.children}
    </a>
  );
}

export function LinkedText(props: { children: string }) {
  return (
    <>
      {splitLinks(props.children).map((piece, i) =>
        typeof piece === "string" ? (
          piece
        ) : (
          <GlassLink key={i} href={piece.href}>
            {shortenUrl(piece.url)}
          </GlassLink>
        )
      )}
    </>
  );
}
