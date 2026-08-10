import { Data } from "effect";

/**
 * CLI-facing tagged errors. The error renderer (see ./render.ts) maps each
 * `_tag` to a STDERR JSON object + a process exit code. STDOUT always stays
 * pure data.
 *
 * Exit-code contract:
 *   NotFoundError         -> 2
 *   ParseError            -> 3 (invalid input / parse)
 *   DatabaseError         -> 4 (db / internal)
 *   LocalOnlyCommandError -> 7 (this command needs the author's machine)
 *
 * These tags are part of the public CLI output contract — do NOT rename them.
 * NOTE: there is also a DOMAIN `NotFoundError` in @/services/db-service-errors
 * with a different shape ({ type, params }). In CLI command code you should
 * ALWAYS construct the CLI errors below (via `notFound`/`parseError`/`dbError`)
 * — the CLI owns not-found detection. The renderer still maps any leaked
 * domain tag to the right exit code defensively.
 */
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  /** The entity noun, e.g. "video", "section". */
  readonly entity: string;
  /** Present when a single id was missing. */
  readonly id?: string;
  /** Present for multi-id `get` partial failure: every missing id. */
  readonly ids?: ReadonlyArray<string>;
}> {}

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string;
  /** Optional entity noun the bad input related to. */
  readonly entity?: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
}> {}

/**
 * A command that needs the AUTHOR'S MACHINE was run somewhere else.
 *
 * Its own tag, and its own exit code, because none of the others describe it:
 * nothing is missing (2), the input was fine (3), and nothing broke (4). The
 * only correct response is to stop — this command can never work on this box —
 * and a tag is what lets an agent tell that apart from a failure worth retrying.
 */
export class LocalOnlyCommandError extends Data.TaggedError(
  "LocalOnlyCommandError"
)<{
  /** The refused invocation, e.g. "cvm course publish". */
  readonly command: string;
  /** What it needs, in plain words — the reason it can never work here. */
  readonly reason: string;
  readonly message: string;
}> {}

/** Union of every error a CLI command handler is allowed to fail with. */
export type CliError =
  NotFoundError | ParseError | DatabaseError | LocalOnlyCommandError;

/** Construct a single-id not-found error (exit 2). */
export const notFound = (entity: string, id: string): NotFoundError =>
  new NotFoundError({ entity, id });

/** Construct a multi-id not-found error (exit 2) for variadic `get`. */
export const notFoundMany = (
  entity: string,
  ids: ReadonlyArray<string>
): NotFoundError => new NotFoundError({ entity, ids });

/** Construct an invalid-input/parse error (exit 3). */
export const parseError = (message: string, entity?: string): ParseError =>
  new ParseError({ message, entity });

/** Construct a db/internal error (exit 4). */
export const dbError = (message: string): DatabaseError =>
  new DatabaseError({ message });
