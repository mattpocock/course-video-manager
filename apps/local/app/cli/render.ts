import { HelpDoc, ValidationError } from "@effect/cli";
import { Cause, Effect, Option } from "effect";
import { storageRootOfflineErrorOf } from "@/packages/storage";
import { readStorageRootsOrNone } from "@/services/storage-roots";
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
 *   NotFoundError               -> 2
 *   ParseError                  -> 3
 *   DatabaseError               -> 4
 *   AuthenticationError         -> 5
 *   SchemaVersionMismatchError  -> 6
 *   LocalOnlyCommandError       -> 7
 *   ClipLayersChangedError      -> 8
 *   StorageRootOfflineError     -> 4 (any filesystem failure on an Offline root)
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
  // A Publish Job succeeded but its `published` Job Event was never written,
  // so its ids are unknown. The release is out; the result is what failed.
  PublishResultLostError: 4,
  // `cvm course publish discard` left the Pending Version alone: its Publish
  // is still running, or its receipt landed or cannot be read. A state the
  // caller must change first, like PublishValidationError.
  PendingDiscardRefusedError: 3,
  // A write refused because it targeted a non-Draft (Pending/Published)
  // version — invalid input, like PublishValidationError.
  VersionNotDraftError: 3,
  // An Agent Session upload broke a content rule (a skill body or tool
  // result, an absolute path, a secret) or matched several Agent Sessions.
  // Invalid input: `reasons` says what to fix.
  AgentSessionUploadRefusedError: 3,
  // A Clip's Layers refused (a Source Crop outside the frame, a Placement
  // with no area, a Scene Layer off the bottom): invalid input.
  ClipLayersRefusedError: 3,
  // `cvm footage frame` / `cvm clip frame` asked for while the recorder
  // records: the Still Gate's "ask again after the Stop". Not a failure of
  // this machine; the same command succeeds once the take stops.
  StillHeldError: 3,
  // A frame refused for its input: a t outside the Footage or the Clip, or a
  // Video whose frame cannot be drawn yet.
  FrameRefusedError: 3,
  // `cvm short post` refused a Short (a Landscape Video, a default title, no
  // description, already queued, already Posted): invalid input. Nothing
  // was queued; `refusals` names each Short and why.
  ShortPostRefusedError: 3,
  // `cvm short move` / `cvm short unqueue` refused a Short (Posting, or not
  // in the Posting Queue): invalid input. Nothing changed.
  PostingQueueChangeRefusedError: 3,
  // Defensive: domain error tags that could leak through a command.
  UnknownDBServiceError: 4,
  // The deployed API rejected the token — unknown, expired or revoked; it
  // never says which. This gets a code of its OWN because "your token expired"
  // and "that Video does not exist" are fixed by completely different actions,
  // and an agent that cannot tell them apart retries a credential failure
  // forever. Everything an agent must do about it is in the message.
  AuthenticationError: 5,
  // The API could not be reached, or answered with something unreadable —
  // an internal failure like any other, so exit 4.
  TransportError: 4,
  // This checkout and the deployed API were built against different schemas.
  // Its own code because the fix is neither "retry" nor "get a new token": it
  // is `git pull` on this box, and the message says so with both numbers in it.
  SchemaVersionMismatchError: 6,
  // The command needs the author's machine and this is not it. Its own code
  // because the only correct response is to STOP: no retry, no new token, no
  // pull will make `cvm file` work on a box with no Video Files directory.
  LocalOnlyCommandError: 7,
  // A Clip's Layers changed between the command's read and its write: another
  // command edited them at the same time. Its own code because the fix is
  // neither "fix the input" nor "stop": run the same command again, and it
  // works on the Layers as they are now. Nothing was written.
  ClipLayersChangedError: 8,
  // An HTML page could not be turned into a Clip Mockup frame (the browser
  // would not launch, or the page would not render). Internal-failure class:
  // the input was a real, readable file, something on this machine broke. It
  // is listed rather than left to the default so the contract is written down.
  FrameCaptureError: 4,
  // `cvm diagram create` could not draw its PNG — usually the app is not
  // running at CVM_APP_URL. Same class: something on this machine, not the
  // input. Nothing is written.
  DiagramRenderError: 4,
  // CVM_API_URL / CVM_API_TOKEN are missing. Same class as a missing
  // DATABASE_URL always was: exit 4.
  ConfigurationError: 4,
  // A Storage Root is Offline (an unplugged drive, a stale WSL mount). Same
  // class: something on this machine. The message names the drive and what
  // to do; reconnecting it and retrying is the fix.
  StorageRootOfflineError: 4,
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

    // `message` has to be asked for by name. Every Data.TaggedError extends
    // Error, which makes an assigned message a non-enumerable OWN property, and
    // a computed one (VersionNotDraftError) a prototype getter — Object.entries
    // sees neither. Reading it off the object catches both, and the message is
    // the only part of a failure that tells an agent what to DO about it.
    const message = (source as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") obj.message = message;
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

          // A filesystem failure on an Offline Storage Root (ENODEV on a
          // stale WSL mount) says which drive and what to do, never the raw
          // error, whichever `fs` call hit it — as the app server's
          // route-action and the Sidecar's job failure already do.
          const error =
            storageRootOfflineErrorOf(
              failure.value,
              readStorageRootsOrNone()
            ) ?? failure.value;

          // @effect/cli validation errors (bad args/options). Help/version
          // built-ins are handled internally by `run` and succeed, so a
          // surfaced HelpRequested is treated as a clean exit.
          if (ValidationError.isValidationError(error)) {
            if (error._tag === "HelpRequested") return 0;
            // A bad value's own explanation (e.g. "that's a Pitch link, this
            // command wants a Video" from ./entity-id.ts) rides along, so the
            // agent learns what to pass instead of just that it was wrong.
            const detail =
              error._tag === "InvalidValue" || error._tag === "InvalidArgument"
                ? HelpDoc.toAnsiText(error.error)
                    // eslint-disable-next-line no-control-regex
                    .replace(/\x1b\[[0-9;]*m/g, "")
                    .trim()
                : "";
            yield* out.stderr(
              serializeError("ParseError", {
                message:
                  `invalid CLI input (${error._tag})` +
                  (detail ? `: ${detail}` : ""),
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
