import { Schema } from "effect";
import {
  ANNOUNCE_NOTHING_BAND,
  PLACEHOLDER_FLOOR_BANDS,
} from "@/packages/course-json/client";
import { findYouTubeMetadataProblem } from "@/lib/youtube-metadata";
import { STORAGE_MOVE_KINDS } from "@/packages/storage/client";

const NonEmptyPath = Schema.String.pipe(Schema.nonEmptyString());

/** A file the per-bucket page listed: where, and its path relative to there. */
const FileAtParam = Schema.Struct({
  location: Schema.String.pipe(
    Schema.filter((p) => p.startsWith("/"), {
      message: () => "a location is an absolute path",
    })
  ),
  path: NonEmptyPath,
});

/** A Storage Root: an absolute path. */
const StorageRootParam = Schema.String.pipe(
  Schema.filter((p) => p.startsWith("/"), {
    message: () => "a Storage Root is an absolute path",
  })
);

/**
 * Refuses a title or description YouTube would refuse, naming why — at
 * enqueue (the app server) and again when the Sidecar decodes the Job, so a
 * Job queued before this check still never reaches YouTube.
 */
const youtubeMetadataAccepted = <
  A extends { readonly title: string; readonly description: string },
  I,
>(
  schema: Schema.Schema<A, I>
) =>
  schema.pipe(
    Schema.filter(
      (metadata) => findYouTubeMetadataProblem(metadata)?.message ?? true
    )
  );

export const JOB_PARAMS = {
  noop: Schema.Struct({
    /** How long to take, in steps of up to 100 ms, reporting each. */
    durationMs: Schema.optionalWith(
      Schema.Number.pipe(Schema.int(), Schema.between(0, 600_000)),
      { default: () => 0 }
    ),
    /** Fail every attempt up to and including this one. */
    failAttempts: Schema.optionalWith(
      Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      { default: () => 0 }
    ),
  }),
  export: Schema.Struct({ videoId: Schema.String }),
  /** A Video's Animatic, rendered to `finished-videos/` like its export. */
  "export-animatic": Schema.Struct({ videoId: Schema.String }),
  "render-vertical": Schema.Struct({ videoId: Schema.String }),
  "batch-export": Schema.Struct({
    versionId: Schema.String,
    // Export All ships everything unless to-do Lessons are being withheld.
    includeTodoLessons: Schema.optionalWith(Schema.Boolean, {
      default: () => true,
    }),
  }),
  /** The Clips one transcribe request named; at least one. */
  "transcribe-clips": Schema.Struct({
    clipIds: Schema.NonEmptyArray(Schema.String),
  }),
  /** A body whose local images go to Cloudinary; the body itself is never written back. */
  "upload-images": Schema.Struct({
    videoId: Schema.String,
    body: Schema.String,
  }),
  /** Local image files the tab swapped Cloudinary URLs in for; at least one. */
  "remove-local-images": Schema.Struct({
    videoId: Schema.String,
    filePaths: Schema.NonEmptyArray(Schema.String),
  }),
  /** One Footage file, by its absolute path (Footage has no row). */
  "transcribe-footage": Schema.Struct({
    path: Schema.String.pipe(
      Schema.filter((p) => p.startsWith("/"), {
        message: () => "a footage path must be absolute",
      })
    ),
  }),
  /** A Course copied under a new name; the route chose the new Course's id. */
  "duplicate-course": Schema.Struct({
    sourceCourseId: Schema.String,
    name: Schema.Trim.pipe(Schema.nonEmptyString()),
    newCourseId: Schema.UUID,
  }),
  /** A Storage Bucket's files of one kind, copied to one Storage Root. */
  "storage-move": Schema.Struct({
    bucketId: Schema.String.pipe(Schema.nonEmptyString()),
    kind: Schema.Literal(...STORAGE_MOVE_KINDS),
    /** Only these files (root-relative), from the per-bucket page; absent, all. */
    paths: Schema.optional(
      Schema.NonEmptyArray(Schema.String.pipe(Schema.nonEmptyString()))
    ),
    target: Schema.String.pipe(
      Schema.filter((p) => p.startsWith("/"), {
        message: () => "a Storage Root is an absolute path",
      })
    ),
  }),
  /**
   * A delete on the Storage page (#2110), by `operation` — one member each
   * (`STORAGE_DELETE_OPERATIONS`). `originals`: the bucket's files on `from`
   * that have an identical copy on another Storage Root.
   */
  "storage-delete": Schema.Union(
    Schema.Struct({
      operation: Schema.Literal("originals"),
      bucketId: Schema.String.pipe(Schema.nonEmptyString()),
      from: StorageRootParam,
      /** Per-file (#2157): only these files, root-relative. */
      paths: Schema.optional(Schema.NonEmptyArray(NonEmptyPath)),
    }),
    Schema.Struct({
      operation: Schema.Literal("purge-exports"),
      bucketId: Schema.String.pipe(Schema.nonEmptyString()),
      /** The ticked Exported Videos (root-relative); absent, the bucket. */
      exportPaths: Schema.optional(Schema.NonEmptyArray(NonEmptyPath)),
    }),
    Schema.Struct({
      operation: Schema.Literal("delete-bucket"),
      bucketId: Schema.String.pipe(Schema.nonEmptyString()),
      /** Per-file: only these files; absent, the bucket. */
      files: Schema.optional(Schema.NonEmptyArray(FileAtParam)),
    }),
    Schema.Struct({
      operation: Schema.Literal("trash-unused"),
      /** Per-file: only these files; absent, all Unused Footage. */
      files: Schema.optional(Schema.NonEmptyArray(FileAtParam)),
    }),
    Schema.Struct({
      operation: Schema.Literal("restore-trash"),
      files: Schema.NonEmptyArray(
        Schema.Struct({
          location: StorageRootParam,
          batch: NonEmptyPath,
          path: NonEmptyPath,
        })
      ),
    }),
    Schema.Struct({ operation: Schema.Literal("empty-trash") }),
    Schema.Struct({ operation: Schema.Literal("expire-trash") })
  ),
  /**
   * The Clip Mockups one `cvm clip-mockup add` or `update` left with a
   * voice to make; at least one.
   */
  "clip-mockup-voice": Schema.Struct({
    clipMockupIds: Schema.NonEmptyArray(Schema.String),
    /** Each one's line as it was queued: the dedupe key (`voice-job-cover.ts`). */
    lines: Schema.Record({ key: Schema.String, value: Schema.String }),
  }),
  autofill: Schema.Struct({
    /** For the success toast's "Back to Publish"; the run reads only the Version. */
    courseId: Schema.String,
    versionId: Schema.String,
    // Required, as the route had it: it decides which Videos the run acts on.
    includeTodoLessons: Schema.Boolean,
  }),
  publish: Schema.Struct({
    courseId: Schema.String,
    name: Schema.String,
    // Required, like name: a Published Version always carries a description.
    description: Schema.String,
    includeTodoLessons: Schema.optionalWith(Schema.Boolean, {
      default: () => true,
    }),
    // The Placeholder Floor as a band, as the CLI spells it. Absent means
    // announce nothing.
    placeholders: Schema.optionalWith(
      Schema.Literal(...PLACEHOLDER_FLOOR_BANDS),
      { default: () => ANNOUNCE_NOTHING_BAND }
    ),
  }),
  youtube: youtubeMetadataAccepted(
    Schema.Struct({
      videoId: Schema.String,
      title: Schema.Trim.pipe(Schema.nonEmptyString()),
      description: Schema.Trim.pipe(Schema.nonEmptyString()),
      privacyStatus: Schema.Literal("public", "unlisted"),
      thumbnailId: Schema.String,
    })
  ),
  "youtube-shorts": youtubeMetadataAccepted(
    Schema.Struct({
      videoId: Schema.String,
      title: Schema.Trim.pipe(Schema.nonEmptyString()),
      description: Schema.Trim.pipe(Schema.nonEmptyString()),
    })
  ),
  buffer: Schema.Struct({
    videoId: Schema.String,
    caption: Schema.Trim.pipe(Schema.nonEmptyString()),
  }),
  "ai-hero": Schema.Struct({
    videoId: Schema.String,
    title: Schema.Trim.pipe(Schema.nonEmptyString()),
    body: Schema.String,
    description: Schema.String,
    slug: Schema.String,
  }),
  "skills-changelog": Schema.Struct({
    videoId: Schema.String,
    title: Schema.Trim.pipe(Schema.nonEmptyString()),
    slug: Schema.String,
    body: Schema.String,
    description: Schema.String,
    newsletterSubject: Schema.Trim.pipe(Schema.nonEmptyString()),
    newsletterPreviewText: Schema.String,
    newsletterCopy: Schema.String.pipe(
      Schema.filter((copy) => copy.trim().length > 0, {
        message: () => "Newsletter copy is required",
      })
    ),
  }),
} as const;
