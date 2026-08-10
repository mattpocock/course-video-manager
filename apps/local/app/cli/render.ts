import { ValidationError } from "@effect/cli";
import { Cause, Effect, Option } from "effect";
import { CliOutput } from "./output";

/**
 * THE single top-level error-renderer. Process analog of buildErrorPipeline /
 * errorMap in app/services/route-action.server.ts.
 *
 * It takes the command program (which may fail) and turns it into an Effect
 * that NEVER fails and RETURNS the process exit code. Exit code is a return
 * VALUE — process.exit happens only at the bin edge (see ./bin.mjs).
 *
 * Tag -> exit code:
 *   NotFoundError        -> 2
 *   ParseError           -> 3
 *   DatabaseError        -> 4
 *   (@effect/cli ValidationError, bad input) -> 3
 *   (defect / unknown tag / die)             -> 4 (rendered as DatabaseError)
 *
 * The error JSON goes to STDERR (via CliOutput). STDOUT is never touched here,
 * so data already emitted by the command (e.g. found objects of a partial
 * multi-id `get`) stays pure.
 */
const EXIT_CODES: Record<string, number> = {
  NotFoundError: 2,
  ParseError: 3,
  DatabaseError: 4,
  // A publish gated on unexported videos / lint is an invalid-input failure,
  // not an internal one. `course publish` lets it surface untouched so its
  // structured fields (unexportedVideoIds, courseViewLintCount) reach the agent.
  PublishValidationError: 3,
  // The Dropbox commit failed (after one in-flight retry for sync_failed);
  // the Pending Version was auto-Discarded and the edits are safe in the new
  // Draft (issue #1401). Internal-failure class: exit 4.
  PublishCommitFailedError: 4,
  // A write refused because it targeted a non-Draft (Pending/Published)
  // version — invalid input, like PublishValidationError.
  VersionNotDraftError: 3,
  // Defensive: domain error tags that could leak through a command.
  UnknownDBServiceError: 4,
};

const exitCodeForTag = (tag: string): number => EXIT_CODES[tag] ?? 4;

/** Serialize a tagged error into the contract's STDERR JSON shape. */
const serializeError = (tag: string, source: unknown): string => {
  const obj: Record<string, unknown> = { _tag: tag };
  if (source != null && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      if (
        key === "_tag" ||
        value === undefined ||
        typeof value === "function"
      ) {
        continue;
      }
      obj[key] = value;
    }
  }
  return JSON.stringify(obj);
};

const tagOf = (error: unknown): string =>
  error != null &&
  typeof error === "object" &&
  "_tag" in error &&
  typeof (error as { _tag: unknown })._tag === "string"
    ? (error as { _tag: string })._tag
    : "DatabaseError";

/**
 * Wrap a command program with the renderer. Returns the exit code.
 * CliOutput must be provided downstream (it is, at the program edge).
 */
export const renderToExitCode = <E, R>(
  program: Effect.Effect<void, E, R>
): Effect.Effect<number, never, R | CliOutput> =>
  program.pipe(
    Effect.matchCauseEffect({
      onSuccess: () => Effect.succeed(0),
      onFailure: (cause: Cause.Cause<E>) =>
        Effect.gen(function* () {
          const out = yield* CliOutput;
          const failure = Cause.failureOption(cause);

          // Defect / die (no typed failure) -> internal, exit 4.
          if (Option.isNone(failure)) {
            yield* out.stderr(
              serializeError("DatabaseError", {
                message: Cause.pretty(cause),
              }) + "\n"
            );
            return 4;
          }

          const error = failure.value;

          // @effect/cli validation errors (bad args/options). Help/version
          // built-ins are handled internally by `run` and succeed, so a
          // surfaced HelpRequested is treated as a clean exit.
          if (ValidationError.isValidationError(error)) {
            if (error._tag === "HelpRequested") return 0;
            yield* out.stderr(
              serializeError("ParseError", {
                message: `invalid CLI input (${error._tag})`,
              }) + "\n"
            );
            return 3;
          }

          const tag = tagOf(error);

          // Normalize leaked domain DB error to the public DatabaseError tag.
          if (tag === "UnknownDBServiceError") {
            yield* out.stderr(
              serializeError("DatabaseError", {
                message: "internal database error",
              }) + "\n"
            );
            return 4;
          }

          yield* out.stderr(serializeError(tag, error) + "\n");
          return exitCodeForTag(tag);
        }),
    })
  );
