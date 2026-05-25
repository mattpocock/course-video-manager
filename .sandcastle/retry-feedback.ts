import { StructuredOutputError } from "@ai-hero/sandcastle";

/**
 * Build the feedback block appended to (or sent as) the extraction prompt on a
 * retry. It shows the agent exactly what it emitted last time and why it failed
 * validation — the highest-leverage signal for getting valid output next time.
 *
 * The returned text always contains the literal opening tag (`<tag>`), which
 * satisfies Sandcastle's "resolved prompt must contain the opening tag literal"
 * constraint when this block is used as a standalone retry prompt.
 *
 * Shared by both two-phase wrappers: `runWithExtraction` (resumes the produce
 * session) and `runWithRetry` (resumes the failed call's own session).
 */
export function buildRetryFeedback(
  error: StructuredOutputError,
  attempt: number,
  maxAttempts: number
): string {
  const header = `## Previous attempt failed (now on attempt ${attempt} of ${maxAttempts})`;

  if (error.rawMatched === undefined) {
    return [
      header,
      "",
      `Your previous response did not contain a \`<${error.tag}>\` block at all.`,
      `Emit exactly one \`<${error.tag}>\` block as described above. Do not change any code.`,
    ].join("\n");
  }

  return [
    header,
    "",
    "This is what you emitted last time:",
    "```",
    error.rawMatched,
    "```",
    "",
    "It failed validation for this reason:",
    "```",
    describeCause(error.cause),
    "```",
    "",
    `Fix the problem and re-emit a single corrected \`<${error.tag}>\` block. Do not change any code — only the output.`,
  ].join("\n");
}

/** Render a StructuredOutputError `cause` (JSON parse error or schema issues) as readable text. */
function describeCause(cause: unknown): string {
  const issues = extractIssues(cause);
  if (issues) {
    return issues
      .map((issue) => {
        const path = issue.path
          ?.map((p) => (typeof p === "object" && p !== null ? p.key : p))
          .join(".");
        return path ? `- ${path}: ${issue.message}` : `- ${issue.message}`;
      })
      .join("\n");
  }
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}

/** Pull Standard Schema issues out of a cause, whether it's an array or `{ issues }`. */
function extractIssues(cause: unknown): readonly SchemaIssue[] | undefined {
  if (Array.isArray(cause)) return cause as SchemaIssue[];
  if (
    typeof cause === "object" &&
    cause !== null &&
    "issues" in cause &&
    Array.isArray((cause as { issues: unknown }).issues)
  ) {
    return (cause as { issues: SchemaIssue[] }).issues;
  }
  return undefined;
}
