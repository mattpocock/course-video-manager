// Word-wrapping for what the rig prints. A terminal soft-wraps a long line
// mid-word, and copying it out of Windows Terminal drops the space at the wrap
// ("thevideo", "Phonevolume"). Breaking lines ourselves, at spaces, avoids both.

/** Width used when stdout isn't a terminal (the wizard's log, a pipe). */
export const DEFAULT_COLUMNS = 100;

/**
 * Breaks `line` at spaces into lines of at most `width` characters (a single
 * longer word stays whole). Continuation lines start with `hang`. Joining the
 * result with a space, after taking `hang` off, gives `line` back.
 */
export function wrapLine(line: string, width: number, hang = ""): string[] {
  if (line.length <= width) return [line];
  const words = line.split(" ");
  const out: string[] = [];
  let cur = words[0]!;
  for (const w of words.slice(1)) {
    if (cur.length + 1 + w.length > width && cur.trim() !== "") {
      out.push(cur);
      cur = hang + w;
    } else cur += ` ${w}`;
  }
  out.push(cur);
  return out;
}

/**
 * A report.md excerpt for the console: a two-column table row ("| Criterion |
 * Result |") becomes "  Criterion: Result", and every long line is wrapped,
 * continuation lines indented under it.
 */
export function forTerminal(md: string, columns?: number): string {
  const width = Math.max(40, Math.min(columns || DEFAULT_COLUMNS, 120) - 1);
  return md
    .split("\n")
    .flatMap((l) => {
      if (/^\|-+\|-+\|$/.test(l)) return [];
      const cells = /^\| (.*) \|$/.exec(l)?.[1]?.split(" | ");
      if (cells?.length === 2) {
        if (cells[0] === "Criterion") return [];
        return wrapLine(`  ${cells[0]}: ${cells[1]}`, width, "      ");
      }
      const lead = /^\s*/.exec(l)![0];
      return wrapLine(l, width, `${lead}  `);
    })
    .join("\n");
}
