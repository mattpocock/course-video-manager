interface Fixer<Fix> {
  removeRange(range: [number, number]): Fix;
  replaceTextRange(range: [number, number], text: string): Fix;
}

const BLANK = /[ \t]/;

export const removeComment = <Fix>(
  fixer: Fixer<Fix>,
  text: string,
  range: readonly [number, number]
): Fix => {
  let [start, end] = range;
  while (start > 0 && BLANK.test(text.charAt(start - 1))) start -= 1;
  while (end < text.length && BLANK.test(text.charAt(end))) end += 1;
  const lineStart = start === 0 || text.charAt(start - 1) === "\n";
  const lineEnd =
    end === text.length ||
    text.charAt(end) === "\n" ||
    text.charAt(end) === "\r";
  if (lineStart && lineEnd) {
    if (text.charAt(end) === "\r") end += 1;
    if (text.charAt(end) === "\n") end += 1;
    return fixer.removeRange([start, end]);
  }
  if (lineStart || lineEnd) return fixer.removeRange([start, end]);
  return fixer.replaceTextRange([start, end], " ");
};
