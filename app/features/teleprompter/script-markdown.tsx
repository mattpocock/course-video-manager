/**
 * Inline markdown for the glass.
 *
 * Not the app's `AIResponse` renderer: that one is built for reading a document
 * in a panel — its own type scale, margins, code blocks, images, links. On a
 * teleprompter every one of those fights the crawl. What's wanted is the same
 * line of type, with bold actually bold and a list actually a list.
 *
 * Block-level spacing and size stay with the crawl, which already knows what
 * kind of block this is, so the overrides here strip markdown's own.
 */
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CUE_CLASS, remarkInlineCues } from "./inline-cues";
import { GlassLink, shortenUrl } from "./linked-text";
import { TYPE, cueStyle } from "./teleprompter-settings";

const COMPONENTS: Components = {
  // The crawl supplies the wrapper element and its margin.
  p: ({ children }) => <>{children}</>,
  // Markers inside the text flow, so they stay with the centred column instead
  // of hanging off in space to the left of it.
  ul: ({ children }) => <ul className="list-inside list-disc">{children}</ul>,
  ol: ({ children }) => (
    <ol className="list-inside list-decimal">{children}</ol>
  ),
  li: ({ children }) => <li className="mb-2 last:mb-0">{children}</li>,
  // Medium rather than bold, and explicit rather than `bolder`. Emphasis is
  // carried mostly by colour here, so the weight only has to be enough to read
  // as deliberate — and a true bold blooms through the glass, which is exactly
  // what the light body weight is there to avoid.
  strong: ({ children }) => (
    <strong style={{ fontWeight: 500, color: TYPE.boldColor }}>
      {children}
    </strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  // `remarkInlineCues` marks its spans with `CUE_CLASS`; that class is the
  // whole handshake, so anything else wearing a span stays a plain span.
  span: ({ children, className }) =>
    className === CUE_CLASS ? (
      <span data-cue style={cueStyle()}>
        {children}
      </span>
    ) : (
      <span className={className}>{children}</span>
    ),
  code: ({ children }) => (
    <code className="rounded bg-white/10 px-1 py-0.5">{children}</code>
  ),
  a: ({ children, href }) => (
    <GlassLink href={href}>{urlLabel(children, href) ?? children}</GlassLink>
  ),
  // Headings are their own block kind, split out before this ever runs.
  h1: ({ children }) => <>{children}</>,
  h2: ({ children }) => <>{children}</>,
  h3: ({ children }) => <>{children}</>,
};

/**
 * What to show for a link whose label is the address itself — the `https://…`
 * a writer dropped into a sentence, which GFM turns into a link on its own.
 * Null for a written label like `[the docs](…)`: those are words the author
 * chose to be read aloud, and shortening them would change the line.
 */
function urlLabel(
  children: ReactNode,
  href: string | undefined
): string | null {
  const label =
    Array.isArray(children) && children.length === 1 ? children[0] : children;
  if (!href || typeof label !== "string") return null;

  // How GFM writes the literal forms it recognises: bare (already carrying its
  // protocol), `www.` (which gains one), and an email address (which gains
  // `mailto:`).
  const isUrlItself =
    href === label ||
    href === `https://${label}` ||
    href === `http://${label}` ||
    href === `mailto:${label}`;
  return isUrlItself ? shortenUrl(label) : null;
}

const PLUGINS = [remarkGfm, remarkInlineCues];
/** Cues off: same markdown, minus the pass that greys bracketed asides. */
const PLUGINS_WITHOUT_CUES = [remarkGfm];

export function ScriptMarkdown(props: {
  children: string;
  /**
   * Whether `[bracketed asides]` are marked as cues. Off inside a block that is
   * already a cue — there the direction *is* the block, so a bracket in it is
   * just a bracket, and marking it again would set it smaller again.
   *
   * Required rather than defaulted: which of the two a block wants is the whole
   * reason the caller knows what kind of block it is, and a renderer that
   * quietly picks one when asked nothing is a wrong answer waiting to be
   * omitted.
   */
  cues: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={props.cues ? PLUGINS : PLUGINS_WITHOUT_CUES}
      components={COMPONENTS}
    >
      {props.children}
    </ReactMarkdown>
  );
}
