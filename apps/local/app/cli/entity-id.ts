import { Args, HelpDoc, Options, ValidationError } from "@effect/cli";
import { Effect, Option } from "effect";
import { resolveDraftId, type DraftEntity } from "./stale-id";
import type { NotFoundError } from "./errors";
import type { CliOutput } from "./output";
import type { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  resolveEntityId,
  type EntityType,
} from "@/features/entity-links/entity-deep-link";

/**
 * THE one place a `cvm` argument that names an entity is read. Every
 * positional `<id>` and every entity-valued flag (`--video`, `--section`,
 * `--before`, …) is declared through these two builders, so each accepts
 * anything Matt might paste: a bare id, any CVM link (any origin, any Video
 * tab, a Lesson's `#id`), or the legacy `course:…/video:…` string. The value
 * the handler sees is always the bare id.
 *
 * A link for a different entity type is refused at parse time (exit 3) with
 * a message naming both, e.g. "that's a Pitch link, this command wants a
 * Video".
 */
type Expected = EntityType | ReadonlyArray<EntityType>;

/**
 * Sections, Lessons and Videos get fresh ids with every Course Version, so
 * their arguments are declared with {@link draftIdArg} / {@link draftIdOption}
 * instead, which resolve a stale id or a `lineageId` to the Draft's id. The
 * plain builders refuse them at the type level so that cannot be forgotten.
 */
type PlainEntity = Exclude<EntityType, DraftEntity>;
type PlainExpected = PlainEntity | ReadonlyArray<PlainEntity>;

const resolve = (input: string, expected: Expected) =>
  Effect.try({
    try: () => resolveEntityId(input, expected),
    catch: (e) => (e instanceof Error ? e.message : String(e)),
  });

/** A positional argument naming one entity of `expected` type(s). */
export const entityIdArg = (
  expected: PlainExpected,
  name = "id"
): Args.Args<string> => anyEntityIdArg(expected, name);

const anyEntityIdArg = (expected: Expected, name = "id"): Args.Args<string> =>
  Args.text({ name }).pipe(
    Args.mapEffect((input) =>
      resolve(input, expected).pipe(Effect.mapError((m) => HelpDoc.p(m)))
    )
  );

/** A `--<name>` flag naming one entity of `expected` type(s). */
export const entityIdOption = (
  name: string,
  expected: PlainExpected
): Options.Options<string> => anyEntityIdOption(name, expected);

const anyEntityIdOption = (
  name: string,
  expected: Expected
): Options.Options<string> =>
  Options.text(name).pipe(
    Options.mapEffect((input) =>
      resolve(input, expected).pipe(
        Effect.mapError((m) =>
          ValidationError.invalidValue(HelpDoc.p(`--${name}: ${m}`))
        )
      )
    )
  );

/**
 * A repeatable `--<name>` flag, each value naming one entity of `expected`
 * type(s). (@effect/cli can only repeat a plain option, so this repeats first
 * and resolves each value after.)
 */
export const entityIdsOption = (
  name: string,
  expected: PlainExpected
): Options.Options<ReadonlyArray<string>> =>
  Options.text(name).pipe(
    Options.repeated,
    Options.mapEffect((inputs) =>
      Effect.forEach(inputs, (input) => resolve(input, expected)).pipe(
        Effect.mapError((m) =>
          ValidationError.invalidValue(HelpDoc.p(`--${name}: ${m}`))
        )
      )
    )
  );

/**
 * A Section, Lesson or Video id as a command receives it: an Effect that
 * resolves to the id in the current Draft (see {@link resolveDraftId}). The
 * handler has to `yield*` it to get a string, so every command that takes one
 * accepts a stale id or a stable `lineageId` without doing anything itself.
 */
export type DraftId = Effect.Effect<
  string,
  NotFoundError,
  VersionOperationsService | CliOutput
>;

/** A positional argument naming one Section, Lesson or Video. */
export const draftIdArg = (
  entity: DraftEntity,
  name = "id"
): Args.Args<DraftId> =>
  anyEntityIdArg(entity, name).pipe(
    Args.map((id) => resolveDraftId(entity, id))
  );

/** A `--<name>` flag naming one Section, Lesson or Video. */
export const draftIdOption = (
  name: string,
  entity: DraftEntity
): Options.Options<DraftId> =>
  anyEntityIdOption(name, entity).pipe(
    Options.map((id) => resolveDraftId(entity, id))
  );

/** Resolve an optional {@link draftIdOption} to `string | undefined`. */
export const optionalDraftId = (
  ref: Option.Option<DraftId>
): Effect.Effect<
  string | undefined,
  NotFoundError,
  VersionOperationsService | CliOutput
> =>
  Option.match(ref, {
    onNone: () => Effect.succeed(undefined),
    onSome: (id) => id,
  });
