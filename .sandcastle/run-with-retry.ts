import {
  run,
  StructuredOutputError,
  type OutputObjectDefinition,
  type RunOptions,
  type RunResult,
} from "@ai-hero/sandcastle";
import { buildRetryFeedback } from "./retry-feedback";

/**
 * Options for {@link runWithRetry} — the standard `run()` options with `output`
 * required and a `maxAttempts` cap added.
 */
export interface RunWithRetryOptions<T> extends Omit<RunOptions, "output"> {
  /** Structured output to extract. Applied to the first call and every retry. */
  readonly output: OutputObjectDefinition<T>;
  /**
   * Total number of attempts (the first call plus retries) before giving up.
   * Default: 3 — one initial call and up to two resumed retries.
   */
  readonly maxAttempts?: number;
}

/**
 * Run an agent in a single call that both does the work and emits structured
 * output, retrying the *same session* if extraction fails.
 *
 * Use this for **side-effect-free** scripts where the structured output IS the
 * work (e.g. drafting a PR title/description, breaking a PRD into slices). For
 * these, splitting into a separate produce + extract pass (see
 * {@link import("./run-with-extraction").runWithExtraction}) buys nothing — the
 * drafting and the emission are the same act — so we keep one combined prompt:
 *
 * 1. Run `prompt`/`promptFile` WITH the `output` definition. On the happy path
 *    this is a single call.
 * 2. If `run()` throws {@link StructuredOutputError}, resume that same session
 *    (via `error.sessionId`) with a feedback message describing exactly what it
 *    emitted and why it failed. The session still holds all the agent's work, so
 *    it only needs to re-emit corrected output — nothing is re-done. Retry up to
 *    `maxAttempts` times total.
 *
 * Resuming the failed session (rather than re-running from scratch) is only
 * possible because `StructuredOutputError` carries `sessionId` — see the host's
 * Sandcastle dependency (>= 0.5.12).
 *
 * Throws the final {@link StructuredOutputError} if every attempt fails, which
 * mirrors the pre-wrapper failure path.
 */
export async function runWithRetry<T>(
  options: RunWithRetryOptions<T>
): Promise<RunResult & { output: T }> {
  const { output, maxAttempts = 3, ...runOptions } = options;

  let lastError: StructuredOutputError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!lastError) {
        // First attempt: the original prompt does the work AND emits output.
        return await run({ ...runOptions, output });
      }

      // Retry: resume the failed session and feed back what went wrong. The
      // session still holds everything the agent did, so it only re-emits.
      const sessionId = lastError.sessionId;
      if (!sessionId) {
        throw new Error(
          "runWithRetry: the failed run carried no sessionId, so it cannot be " +
            "resumed for a retry. Session capture must be enabled (Claude Code " +
            "provider with sessions written to the host)."
        );
      }

      return await run({
        ...runOptions,
        name: runOptions.name
          ? `${runOptions.name} (retry ${attempt - 1})`
          : undefined,
        promptFile: undefined,
        prompt: buildRetryFeedback(lastError, attempt, maxAttempts),
        resumeSession: sessionId,
        output,
      });
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
