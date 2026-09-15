import { HelpDoc, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import type { UnknownDBServiceError } from "@/services/db-service-errors";
import { CliOutput } from "./output";
import {
  NotFoundError,
  notFound,
  notFoundMany,
  parseError,
  type ParseError,
} from "./errors";

/**
 * Shared verb helpers for every noun command. Command handlers should route ALL
 * output through these (never console.log) so output stays swappable/testable.
 */

// ---------------------------------------------------------------------------
// Help text: long-form detail, hidden from parent listings
// ---------------------------------------------------------------------------

/**
 * Wrap a command's long-form help so it renders IN FULL on that command's own
 * `--help`, but does NOT get inlined into parent COMMANDS listings.
 *
 * @effect/cli renders `getSpan(description)` for each entry in a parent's
 * subcommand listing. `getSpan` of a paragraph is the whole paragraph (so a
 * single `p(longText)` floods `cvm --help` with every leaf's full help — ~800
 * lines), but `getSpan` of a `sequence` is empty. Wrapping the prose in a
 * sequence therefore keeps `cvm --help` and every noun's `--help` a compact
 * command index, while the command's OWN `--help` still prints the full text in
 * its DESCRIPTION section. The detail is always one `<noun> <verb> --help` away.
 *
 * One-line summaries for the index live in the parent descriptions' NOUNS /
 * VERBS blocks (ROOT_HELP, COURSE_HELP, …), which are authored by hand.
 */
export const detail = (text: string): HelpDoc.HelpDoc => {
  // Must be a genuine multi-block `Sequence` for getSpan to be empty:
  // `sequence(empty, x)` collapses back to `x`, and getSpan of a lone paragraph
  // is its full text. Splitting the prose into two paragraphs at the first
  // blank line yields a real Sequence (getSpan -> empty) while the command's own
  // `--help` still renders the whole thing, blank line and all.
  const idx = text.indexOf("\n\n");
  return idx === -1
    ? HelpDoc.sequence(HelpDoc.p(text), HelpDoc.p(""))
    : HelpDoc.sequence(
        HelpDoc.p(text.slice(0, idx)),
        HelpDoc.p(text.slice(idx + 2))
      );
};

// ---------------------------------------------------------------------------
// Uniform display name
// ---------------------------------------------------------------------------

/**
 * The single human-readable label of ANY row, regardless of noun.
 *
 * The CVM schema spells its label column differently per table — `name` on
 * courses/versions, `title` on lessons/pitches/deliverables/videos, `path` on
 * sections — so a flat `list` row exposes whichever raw column it
 * happens to have and an agent that asks for `.name` gets nothing. `tree`
 * already papers over this by synthesising a `name` per level; `displayName`
 * is that same normalisation as a reusable function so flat `list` output can
 * carry a uniform `name` too. Precedence mirrors the tree builders: a real
 * `name`, else a non-empty `title`.
 *
 * Returns null only when a row genuinely has no label-bearing field.
 */
export const displayName = (row: unknown): string | null => {
  const r = (row ?? {}) as Record<string, unknown>;
  const pick = (v: unknown): string | null =>
    typeof v === "string" && v !== "" ? v : null;
  return pick(r.name) ?? pick(r.title) ?? pick(r.path);
};

/** Spread `row` and prepend a normalised `name` (see {@link displayName}). */
export const withName = <T>(row: T): T & { name: string | null } => ({
  name: displayName(row),
  ...row,
});

// ---------------------------------------------------------------------------
// Mutually-exclusive flag guard
// ---------------------------------------------------------------------------

/**
 * Fail with an invalid-input error (exit 3) when two mutually-exclusive flags
 * are BOTH provided. Only the "both" shape is shared across the write verbs;
 * each caller keeps its own "neither" handling (append / standalone / require
 * exactly one all differ), so that stays at the call site.
 */
export const rejectBothFlags = (params: {
  readonly a: unknown;
  readonly b: unknown;
  readonly flags: readonly [string, string];
  readonly entity: string;
}): Effect.Effect<void, ParseError> =>
  params.a !== undefined && params.b !== undefined
    ? Effect.fail(
        parseError(
          `pass at most one of ${params.flags[0]} / ${params.flags[1]}`,
          params.entity
        )
      )
    : Effect.void;

// ---------------------------------------------------------------------------
// Output emitters
// ---------------------------------------------------------------------------

/**
 * Recursively omit the `memory` field from any embedded `repo` relation
 * (drizzle's name for the owning Course row: `section.repoVersion.repo`,
 * `video.lesson.section.repoVersion.repo`, and so on). The hierarchy-walking
 * `get`/`move`/write-echo commands (section, lesson, video) pull all the way
 * up to the course row for its `id`/`name`/`slug`, but the course's free-text
 * `memory` field (authoring notes / style guide) routinely runs 1000+ chars —
 * dwarfing the rest of the payload — and is almost never what a section/
 * lesson/video command's caller wants. `cvm course get <id>` is the direct,
 * deliberate way to read it.
 *
 * `repo` is only ever this one relation name in the schema (confirmed: it
 * appears nowhere else as a key), so stripping by key name alone is safe.
 * Applied by default in `emitObject`/`emitNdjson`/`emitGet`; pass
 * `{ includeMemory: true }` to keep it.
 */
const stripEmbeddedMemory = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripEmbeddedMemory);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      if (
        key === "repo" &&
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        "memory" in (v as Record<string, unknown>)
      ) {
        const { memory: _memory, ...rest } = v as Record<string, unknown>;
        out[key] = rest;
      } else {
        out[key] = stripEmbeddedMemory(v);
      }
    }
    return out;
  }
  return value;
};

/** Shared opt-in for the emit helpers below. */
export interface EmitOptions {
  /** Keep an embedded course `repo.memory` blob instead of stripping it. */
  readonly includeMemory?: boolean;
}

/**
 * Emit a SINGLE object (the `get <id>` of one id, version/tree-less reads).
 * Pretty-printed JSON + trailing newline to STDOUT.
 */
export const emitObject = (
  value: unknown,
  opts?: EmitOptions
): Effect.Effect<void, never, CliOutput> =>
  Effect.flatMap(CliOutput, (out) =>
    out.stdout(
      JSON.stringify(
        opts?.includeMemory ? value : stripEmbeddedMemory(value),
        null,
        2
      ) + "\n"
    )
  );

/**
 * Emit a LIST as NDJSON — one COMPACT object per line to STDOUT.
 * Empty input prints nothing (exit stays 0). Use for `list` and multi-id `get`.
 */
export const emitNdjson = (
  values: Iterable<unknown>,
  opts?: EmitOptions
): Effect.Effect<void, never, CliOutput> =>
  Effect.flatMap(CliOutput, (out) =>
    Effect.forEach(
      Array.from(values),
      (value) =>
        out.stdout(
          JSON.stringify(
            opts?.includeMemory ? value : stripEmbeddedMemory(value)
          ) + "\n"
        ),
      { discard: true }
    )
  );

/**
 * Write a plain informational line to STDERR without affecting the exit code
 * or STDOUT's purity — for notices like search's truncation marker. Not an
 * error: nothing here should ever change EXIT_CODES in ./render.ts.
 */
export const note = (text: string): Effect.Effect<void, never, CliOutput> =>
  Effect.flatMap(CliOutput, (out) => out.stderr(text + "\n"));

/**
 * Shared `--full` flag for `list` verbs that default to a compact projection
 * (learning-goal, beat, section): pass it to opt into the complete row.
 */
export const fullOption = Options.boolean("full").pipe(
  Options.withDescription(
    "Emit the complete record instead of the compact list projection."
  )
);

/**
 * Shared `--include-memory` flag for `get` verbs (section, lesson, video)
 * that walk up to the owning Course for its identity: pass it to keep the
 * Course's `memory` field instead of the default strip (see
 * {@link stripEmbeddedMemory} above). `cvm course get <id>` is the direct way
 * to read `memory` without this flag.
 */
export const includeMemoryOption = Options.boolean("include-memory").pipe(
  Options.withDescription(
    "Keep the owning course's `memory` field (stripped by default here — use " +
      "'cvm course get <id>' to read it directly)."
  )
);

// ---------------------------------------------------------------------------
// Variadic `get` with multi-id partial-failure handling
// ---------------------------------------------------------------------------

/**
 * Implements the `get <id...>` contract end-to-end:
 *   - Single id, found            -> one pretty object on STDOUT, exit 0.
 *   - Single id, missing          -> fail NotFoundError -> stderr + exit 2.
 *   - Multiple ids                -> NDJSON of FOUND objects on STDOUT;
 *                                    if any missing, FAIL notFoundMany AFTER
 *                                    emitting found -> missing ids on stderr,
 *                                    exit 2. STDOUT stays pure.
 *
 * `fetch` MUST return the row, or null/undefined when the id does not exist
 * (the CLI owns not-found detection — never throw a domain NotFoundError for an
 * absent row). A genuine DB failure should be left to propagate as its own
 * error (it will render as DatabaseError, exit 4).
 *
 * @example
 * Command.make("get", { ids }, ({ ids }) =>
 *   emitGet({
 *     entity: "video",
 *     ids,
 *     fetch: (id) =>
 *       Effect.flatMap(VideoOperationsService, (svc) => svc.getVideoById(id)),
 *   })
 * )
 */
export const emitGet = <A, E, R>(params: {
  readonly entity: string;
  readonly ids: ReadonlyArray<string>;
  readonly fetch: (id: string) => Effect.Effect<A | null | undefined, E, R>;
  readonly includeMemory?: boolean;
}): Effect.Effect<void, E | NotFoundError, R | CliOutput> =>
  Effect.gen(function* () {
    const { entity, ids, fetch, includeMemory } = params;
    const rows = yield* Effect.all(
      ids.map((id) =>
        fetch(id).pipe(Effect.map((row) => ({ id, row: row ?? undefined })))
      ),
      { concurrency: "unbounded" }
    );

    const found = rows.filter((r) => r.row !== undefined);
    const missing = rows.filter((r) => r.row === undefined).map((r) => r.id);

    if (ids.length === 1) {
      if (found.length === 1) {
        yield* emitObject(found[0]!.row, { includeMemory });
        return;
      }
      return yield* notFound(entity, ids[0]!);
    }

    yield* emitNdjson(
      found.map((r) => r.row),
      { includeMemory }
    );
    if (missing.length > 0) {
      return yield* notFoundMany(entity, missing);
    }
  });

// ---------------------------------------------------------------------------
// Version resolution (draft-by-default, --version to pin)
// ---------------------------------------------------------------------------

/**
 * Resolve the version id for a version-scoped read.
 *
 * - `version` omitted / None  -> the DRAFT version (latest by createdAt) of the
 *   course. No draft -> NotFoundError("version", courseId), exit 2.
 * - `version` provided        -> validated against the db; unknown id ->
 *   NotFoundError("version", id), exit 2.
 *
 * `version` is typed to accept the Option produced by `Options.optional` as
 * well as a plain string / undefined, so it drops straight in from an
 * @effect/cli `--version` option.
 */
export const resolveVersionId = (opts: {
  readonly courseId: string;
  readonly version?: Option.Option<string> | string | undefined;
}): Effect.Effect<
  string,
  NotFoundError | UnknownDBServiceError,
  VersionOperationsService
> =>
  Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    const pinned =
      opts.version === undefined
        ? undefined
        : typeof opts.version === "string"
          ? opts.version
          : Option.getOrUndefined(opts.version);

    if (pinned !== undefined) {
      const version = yield* versionOps
        .getCourseVersionById(pinned)
        .pipe(
          Effect.catchTag("NotFoundError", () => notFound("version", pinned))
        );
      return version.id;
    }

    const draft = yield* versionOps.getLatestCourseVersion(opts.courseId);
    if (draft === undefined) {
      return yield* notFound("version", opts.courseId);
    }
    return draft.id;
  });

// ---------------------------------------------------------------------------
// Re-exports so noun files have ONE import site for errors.
// ---------------------------------------------------------------------------

export {
  NotFoundError,
  notFound,
  notFoundMany,
  parseError,
  dbError,
} from "./errors";
export type { CliError, ParseError } from "./errors";
export { CliOutput } from "./output";
