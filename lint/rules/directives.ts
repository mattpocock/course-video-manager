const DIRECTIVE =
  /^[\s/*]*((?:oxlint|eslint)-disable\S*|@ts-(?:expect-error|ignore|nocheck)|biome-ignore\S*|@effect-diagnostics\S*)(.*)$/s;

const UNLISTED_DIRECTIVE =
  /^\s*(?:(?:oxlint|eslint)-enable\b|prettier-ignore\b|@ts-check\b)/;

const TRIPLE_SLASH_REFERENCE = /^\/\s*<reference\s/;

export const directiveOf = (comment: string): string | undefined => {
  const match = DIRECTIVE.exec(comment);
  if (!match) return undefined;
  return `${match[1]}${match[2]}`.replace(/\s+/g, " ").replace(/[\s*]+$/, "");
};

export const isToolDirective = (comment: {
  type: string;
  value: string;
}): boolean =>
  comment.type === "Shebang" ||
  directiveOf(comment.value) !== undefined ||
  UNLISTED_DIRECTIVE.test(comment.value) ||
  (comment.type === "Line" && TRIPLE_SLASH_REFERENCE.test(comment.value));
