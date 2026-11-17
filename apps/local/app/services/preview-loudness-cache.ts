import { Data, Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import path from "node:path";
import {
  rootRelativePath,
  STORAGE_FOLDERS,
  type StorageRoots,
} from "@/packages/storage";
import {
  assertUnderEffect,
  type PathOutsideBaseDirError,
} from "./assert-under";
import type { FootageStamp } from "./footage-cache";

/**
 * The on-disk cache of a **Footage** file's measured loudness, for the
 * editor's preview gain (`features/video-editor/preview-gain.ts`, #2719).
 *
 * Footage has no row, so, like its transcript (`footage-cache.ts`), the
 * measurement is kept in a companion file beside it: `/d/raw-footage/a.mkv`
 * is measured into `/d/raw-footage/a.mkv.loudness.json`.
 *
 * It is keyed by the file's SIZE and MTIME when it was measured, not by a
 * content hash: hashing a many-GB file costs more than measuring it again,
 * and a stale number only misjudges a preview's volume. A file whose stamp
 * has moved reads as unmeasured, and is measured again.
 *
 * A file that could not be measured is recorded too, with why: it is not
 * asked for again until it changes, and keeps the unmeasured gain meanwhile.
 */

const COMPANION_SUFFIX = ".loudness.json";

const Outcome = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("measured"),
    /** Integrated loudness, LUFS (EBU R128). */
    integratedLufs: Schema.Number,
  }),
  /** The file has no sound stream. */
  Schema.Struct({ kind: Schema.Literal("silent") }),
  Schema.Struct({ kind: Schema.Literal("failed"), message: Schema.String })
);

/** What measuring one file came to. */
export type PreviewLoudness = typeof Outcome.Type;

const PreviewLoudnessFile = Schema.parseJson(
  Schema.Struct({
    version: Schema.Literal(1),
    outcome: Outcome,
    sourceStamp: Schema.Struct({ size: Schema.Number, mtimeMs: Schema.Number }),
    measuredAt: Schema.String,
  })
);

/** The companion a file's loudness is kept in. */
export const previewLoudnessPathFor = (file: string): string =>
  path.resolve(file) + COMPANION_SUFFIX;

/**
 * What measuring `file` (absolute) came to, while `stamp` (its size and
 * mtime now) still matches the stamp it was measured at; null when it has
 * no such record: no companion, an unreadable one, or one of an earlier
 * version of the file.
 */
export const readPreviewLoudness = (
  file: string,
  stamp: FootageStamp
): Effect.Effect<
  PreviewLoudness | null,
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const companion = previewLoudnessPathFor(file);
    if (!(yield* fs.exists(companion))) return null;
    const raw = yield* fs.readFileString(companion);
    const parsed = yield* Schema.decodeUnknown(PreviewLoudnessFile)(raw).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("preview loudness: unreadable companion, ignored", {
          companion,
          error: error.message,
        })
      ),
      Effect.option
    );
    if (parsed._tag === "None") return null;
    const fresh =
      stamp.size === parsed.value.sourceStamp.size &&
      stamp.mtimeMs === parsed.value.sourceStamp.mtimeMs;
    return fresh ? parsed.value.outcome : null;
  });

export class NotOnStorageRootError extends Data.TaggedError(
  "NotOnStorageRootError"
)<{ readonly file: string; readonly message: string }> {}

/**
 * Keep what measuring `file` came to beside it, stamped with the size and
 * mtime `stamp` took BEFORE it was measured (a file written to meanwhile
 * reads as changed). Written only beside Footage under a Storage Root's
 * `raw-footage/`: on a verify-cvm clone the rows still name Matt's real
 * files, and the roots are the run's scratch.
 */
export const writePreviewLoudness = (input: {
  readonly file: string;
  readonly stamp: FootageStamp;
  readonly outcome: PreviewLoudness;
  readonly roots: StorageRoots;
}): Effect.Effect<
  void,
  PlatformError | PathOutsideBaseDirError | NotOnStorageRootError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = path.resolve(input.file);
    const relative = rootRelativePath(file, input.roots);
    if (relative === null) {
      return yield* new NotOnStorageRootError({
        file,
        message: `Not keeping the preview loudness of ${file}: it is on no Storage Root`,
      });
    }
    // The root it is under: the path, less its root-relative tail.
    const root = file.slice(0, file.length - relative.length - 1);
    const target = yield* assertUnderEffect(
      path.join(root, STORAGE_FOLDERS.rawFootage),
      previewLoudnessPathFor(file)
    );
    const contents = yield* Schema.encode(PreviewLoudnessFile)({
      version: 1,
      outcome: input.outcome,
      sourceStamp: input.stamp,
      measuredAt: new Date().toISOString(),
    }).pipe(Effect.orDie);
    yield* fs.writeFileString(target, contents);
  });
