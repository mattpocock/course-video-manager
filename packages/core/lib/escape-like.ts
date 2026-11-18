/** Chars that are wildcards inside a LIKE/ILIKE pattern; escaped to stay literal. */
export const escapeLike = (q: string): string =>
  q.replace(/[\\%_]/g, (c) => `\\${c}`);
