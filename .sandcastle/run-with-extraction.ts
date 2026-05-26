import {
  run,
  type OutputObjectDefinition,
  type RunOptions,
  type RunResult,
} from "@ai-hero/sandcastle";
import { runWithRetry } from "./run-with-retry";

/**
 * Options for {@link runWithExtraction} — the standard `run()` options, but with
 * `output` separated out and an `extractionPrompt` added.
 *
 * The `output` definition is NOT applied to the produce run (see the module
 * docs); it is applied to the extraction run(s) instead.
 */
export interface RunWithExtractionOptions<T> extends Omit<
  RunOptions,
  "output"
> {
  /** Structured output to extract during the extraction pass. */
  readonly output: OutputObjectDefinition<T>;
  /**
   * Prompt for the extraction pass, sent after resuming the produce session.
   * Must contain the configured opening tag literal (e.g. `<output>`), since
   * Sandcastle requires the resolved prompt to contain it.
   */
  readonly extractionPrompt: string;
  /** Maximum number of extraction attempts before giving up. Default: 3. */
  readonly maxAttempts?: number;
}

/**
 * Run an agent in two phases to make structured output reliable.
 *
 * The brittle part of structured output is asking the agent to both *do the
 * work* and *emit rigid JSON* in a single turn — it frequently returns
 * malformed JSON or omits the `<output>` tag, and a single failure aborts the
 * whole run. This wrapper splits the two concerns, which matters when the
 * produce phase has side effects we must not repeat (commits, issue creation):
 *
 * 1. **Produce.** Run the agent on `prompt`/`promptFile` with NO `output`
 *    definition, so `run()` never throws on extraction and we keep the
 *    resumable `sessionId`. The produce prompt should contain no JSON-emission
 *    instructions — it just does the work and reasons in prose.
 * 2. **Extract.** Resume that session with `extractionPrompt` and the `output`
 *    definition, retrying via {@link runWithRetry}: the first attempt resumes
 *    the produce session; any retry resumes the *failed extraction's* own
 *    session with feedback, so the correction happens in-context without
 *    re-doing the work or re-sending the prompt.
 *
 * Returns the produce run's result (commits, branch, stdout) with the
 * extraction run's `output` — extraction must not commit, so the produce
 * commits are the source of truth for callers that inspect `commits`.
 *
 * Throws the final `StructuredOutputError` if every attempt fails, which
 * mirrors the pre-wrapper failure path (the workflow marks the PR/issue
 * blocked).
 *
 * For side-effect-free scripts where the output *is* the work, prefer
 * {@link runWithRetry} directly — there's no work to preserve, so the produce
 * pass is pure overhead.
 */
export async function runWithExtraction<T>(
  options: RunWithExtractionOptions<T>
): Promise<RunResult & { output: T }> {
  const { output, extractionPrompt, maxAttempts, ...produceOptions } = options;

  const produce = await run(produceOptions);

  const sessionId = produce.iterations.at(-1)?.sessionId;
  if (!sessionId) {
    throw new Error(
      "runWithExtraction: produce run returned no sessionId, so the extraction " +
        "pass cannot resume it. Session capture must be enabled (Claude Code " +
        "provider with sessions written to the host)."
    );
  }

  // The extraction pass uses an inline `prompt` (extractionPrompt), so drop the
  // produce phase's `promptArgs` — Sandcastle only allows promptArgs alongside
  // a promptFile, and the extraction prompt needs no substitution.
  const { promptArgs: _produceArgs, ...extractionOptions } = produceOptions;

  const extraction = await runWithRetry({
    ...extractionOptions,
    name: produceOptions.name ? `${produceOptions.name} (extract)` : undefined,
    promptFile: undefined,
    prompt: extractionPrompt,
    resumeSession: sessionId,
    output,
    maxAttempts,
  });

  // Commits/branch come from the produce run (extraction does no work); only
  // the structured output comes from the extraction pass.
  return { ...produce, output: extraction.output };
}
