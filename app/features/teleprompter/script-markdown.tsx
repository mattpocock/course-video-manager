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
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CUE_CLASS, remarkInlineCues } from "./inline-cues";
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
  // Nothing on the glass is clickable, and link colour is just noise.
  a: ({ children }) => <>{children}</>,
  // Headings are their own block kind, split out before this ever runs.
  h1: ({ children }) => <>{children}</>,
  h2: ({ children }) => <>{children}</>,
  h3: ({ children }) => <>{children}</>,
};

export function ScriptMarkdown(props: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkInlineCues]}
      components={COMPONENTS}
    >
      {props.children}
    </ReactMarkdown>
  );
}
