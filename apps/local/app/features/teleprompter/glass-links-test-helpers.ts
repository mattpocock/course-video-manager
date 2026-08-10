/**
 * Reading the links back out of rendered glass.
 *
 * Both surfaces that linkify — the Script's markdown and a Beat Description's
 * plain text — are asserted against the same shape, so a link found one way is
 * held to the same standard as one found the other.
 */
export type RenderedLink = {
  attrs: string;
  href: string;
  text: string;
};

/** Every anchor the renderer produced, in document order. */
export function links(html: string): RenderedLink[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => {
    const attrs = match[1]!;
    return {
      attrs,
      href: /href="([^"]*)"/.exec(attrs)?.[1] ?? "",
      text: match[2]!,
    };
  });
}
