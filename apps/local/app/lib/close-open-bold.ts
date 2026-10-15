/**
 * Markdown bold that is still streaming in, made whole: a Suggestion arrives
 * a few words at a time, so `**` can be open with its closer not yet sent, or
 * half sent as a single `*`. Rendered as is, either shows as literal
 * asterisks until the rest arrives.
 *
 * An open `**` with words after it is closed (before any trailing space, so
 * the closer still sits against the word); one with nothing after it yet is
 * dropped. A finished text with balanced markers comes back unchanged.
 */
export const closeOpenBold = (text: string): string => {
  // Half a marker: one `*` at the very end, not part of a `**`.
  const whole = /(^|[^*])\*$/.test(text) ? text.slice(0, -1) : text;
  const markers = whole.split("**").length - 1;
  if (markers % 2 === 0) return whole;

  const opener = whole.lastIndexOf("**");
  const after = whole.slice(opener + 2);
  if (after.trim() === "") return whole.slice(0, opener).trimEnd();

  const trailing = after.match(/\s*$/)![0];
  return `${whole.slice(0, whole.length - trailing.length)}**${trailing}`;
};
