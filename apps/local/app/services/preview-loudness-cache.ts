import { Data, Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import path from "node:path";
import { STORAGE_FOLDERS, type StorageRoots } from "@/packages/storage";
import {
  assertUnderEffect,
  type PathOutsideBaseDirError,
} from "./assert-under";
import { footageStamp, type FootageStamp } from "./footage-cache";

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
 */

const COMPANION_SUFFIX = ".loudness.json";

const PreviewLoudnessFile = Schema.parseJson(
  Schema.Struct({
    version: Schema.Literal(1),
    /** Integrated loudness (LUFS, EBU R128); null for a file with no sound. */
    integratedLufs: Schema.NullOr(Schema.Number),
    sourceStamp: Schema.Struct({ size: Schema.Number, mtimeMs: Schema.Number }),
    measuredAt: Schema.String,
  })
);

/** What a fresh measurement says: null `integratedLufs` is a file with no sound. */
export interface PreviewLoudness {
  readonly integratedLufs: number | null;
}

/** The companion a file's loudness is kept in. */
export const previewLoudnessPathFor = (file: string): string =>
  path.resolve(file) + COMPANION_SUFFIX;

/**
 * The measured loudness of `file` (absolute), or null when it has none that
 * still matches it: no companion, an unreadable one, or one taken of an
 * earlier version of the file.
 */
export const readPreviewLoudness = (
  file: string
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
    const stamp = yield* footageStamp(file);
    const fresh =
      stamp !== null &&
      stamp.size === parsed.value.sourceStamp.size &&
      stamp.mtimeMs === parsed.value.sourceStamp.mtimeMs;
    return fresh ? { integratedLufs: parsed.value.integratedLufs } : null;
  });

export class NotOnStorageRootError extends Data.TaggedError(
  "NotOnStorageRootError"
)<{ readonly file: string; readonly message: string }> {}

/**
 * Keep `file`'s measured loudness beside it, stamped with the size and mtime
 * `stamp` took BEFORE it was measured (a file written to meanwhile reads as
 * changed). Written only beside Footage under a Storage Root's `raw-footage/`:
 * on a verify-cvm clone the rows still name Matt's real files, and the roots
 * are the run's scratch.
 */
export const writePreviewLoudness = (input: {
  readonly file: string;
  readonly stamp: FootageStamp | null;
  readonly integratedLufs: number | null;
  readonly roots: StorageRoots;
}): Effect.Effect<
  void,
  PlatformError | PathOutsideBaseDirError | NotOnStorageRootError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = path.resolve(input.file);
    const root = input.roots.find((r) => file.startsWith(`${r}/`));
    if (root === undefined) {
      return yield* new NotOnStorageRootError({
        file,
        message: `Not keeping the preview loudness of ${file}: it is on no Storage Root`,
      });
    }
    // A file with no mtime could never be told fresh: nothing worth keeping.
    if (input.stamp === null) return;
    const target = yield* assertUnderEffect(
      path.join(root, STORAGE_FOLDERS.rawFootage),
      previewLoudnessPathFor(file)
    );
    const contents = yield* Schema.encode(PreviewLoudnessFile)({
      version: 1,
      integratedLufs: input.integratedLufs,
      sourceStamp: input.stamp,
      measuredAt: new Date().toISOString(),
    }).pipe(Effect.orDie);
    yield* fs.writeFileString(target, contents);
  });
