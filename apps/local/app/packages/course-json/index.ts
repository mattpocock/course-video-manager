// Entry point (public, server-side) for the course-json package.
//
// Browser-side code wants `./client` instead: this file re-exports the manifest
// builder, which reaches node:crypto through the Export Hash. See ./client.ts.
//
// A deep module: this small surface hides the whole production of a course.json
// manifest — the effective-output filter (which to-do Lessons ship), role
// derivation, chapter building, content-addressed export hashing, and
// empty-Section elision. Import THIS from outside the package — never `./lib/*`.
//
// `buildCourseJson` consumes the effective-output filters internally; they are
// also exported directly because export, validation, and the Dropbox mirror read
// the same Sections — so there is exactly one notion of what a publish ships.
// There are two: `computeEffectiveSections` is every Lesson the release reaches
// (shipping plus Placeholder Lessons — the manifest's tree), and
// `computeShippingSections` is only the Lessons that ship in full (the asset
// set). Anything that exports, uploads, gap-checks or Autofills a Video reads
// the second; anything that describes the release reads the first.
//
// `classifyLessonPublishStatus` is that one notion, stated once: it decides a
// Lesson's Lesson Publish Status — `ships`, `placeholder` or `withheld`, with a
// reason on `withheld` — and the effective-output filter is only its
// application to the tree. Any surface that must name what a release does with
// a Lesson reads the classifier rather than re-deriving it, so the publish page
// and the manifest can never disagree.
//
// The floor's BAND spellings (`none`, `p1`, `p2`, `p3`) ship from here too,
// beside `PlaceholderFloor` itself: the CLI flag, the publish page's stored
// preference and the publish SSE body all have to mean one thing by "p2", and
// none of them can carry `null`.
//
// `computeEffectiveSections` has only in-package callers today
// (`buildCourseJson`). It stays on the entry point because it is one half of a
// pair that is only understandable as a pair, and because this package's own
// tests may reach it no other way (see ./tests and .dependency-cruiser.cjs).
//
// `buildCourseJsonSchema` derives the JSON Schema sidecar (`course.schema.json`)
// from the same `CourseJsonDocumentSchema` that types the manifest — one source
// of truth for both the data and the schema published beside it.

export {
  buildCourseJson,
  collectPublishBlockers,
  IncompleteShippingVideoError,
  InvalidLessonRoleComboError,
  MissingVideoAssetReceiptError,
  InvalidVideoAssetReceiptError,
  type BuildCourseJsonInput,
  type IncompleteVideo,
  type InvalidLessonCombo,
  type VideoAssetReceipt,
  type PublishBlockers,
} from "./lib/build-course-json";

export {
  buildCourseJsonSchema,
  CourseJsonDocumentSchema,
  type CourseJsonDocument,
} from "./lib/course-json-schema";

export { computeEffectiveSections, computeShippingSections } from "./client";

// Through `./client`, not straight from `./lib/lesson-publish-status`, so this
// surface has ONE definition and the two entry points cannot drift. Server-side
// callers keep importing it from here; a browser-side caller must use `./client`
// directly, because reaching it through this file drags the manifest builder and
// its node builtins along with it.
export {
  ANNOUNCE_NOTHING,
  ANNOUNCE_NOTHING_BAND,
  classifyLessonPublishStatus,
  lessonHardGaps,
  PLACEHOLDER_FLOOR_BANDS,
  placeholderFloorFromBand,
  type ClassifiableLesson,
  type ClassifiableVideo,
  type ClassifyLessonOptions,
  type LessonHardGap,
  type LessonPublishStatus,
  type LessonWithheldReason,
  type PlaceholderFloor,
  type PlaceholderFloorBand,
} from "./client";
