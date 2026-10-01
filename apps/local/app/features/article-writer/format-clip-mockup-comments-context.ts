import type { AnimaticLine } from "@/features/animatic/animatic-lines";

/**
 * The author's Clip Mockup Comments as the writer reads them: each comment
 * under the Animatic clip line or divider it hangs off, so the writer knows
 * which moment of the video a note is about. Clip numbers are the ones the
 * Animatic page shows. Empty when no line carries a comment.
 */
export function formatClipMockupCommentsContext(
  lines: readonly AnimaticLine[]
): string {
  return lines
    .filter((line) => line.comments.length > 0)
    .map((line) => {
      const header =
        line.type === "chapter"
          ? `Chapter: ${line.name}`
          : `Clip ${line.position}: "${line.line}"`;
      const comments = line.comments.map(
        (body) => `  - ${body.split("\n").join("\n    ")}`
      );
      return [header, ...comments].join("\n");
    })
    .join("\n");
}
