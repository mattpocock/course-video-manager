// Entry point (public) for the course-json package — a single seam.
//
// A deep module: this small surface hides the whole production of a course.json
// manifest — the effective-output filter (which to-do Lessons ship), role
// derivation, chapter building, content-addressed export hashing, and
// empty-Section elision. Import THIS from outside the package — never `./lib/*`.
//
// `buildCourseJson` consumes the effective-output filter internally; the filter
// is also exported directly because export, validation, and the Dropbox mirror
// read the same effective Sections — so there is exactly one notion of what a
// publish ships.
//
// `buildCourseJsonSchema` derives the JSON Schema sidecar (`course.schema.json`)
// from the same `CourseJsonDocumentSchema` that types the manifest — one source
// of truth for both the data and the schema published beside it.

export {
  buildCourseJson,
  buildCourseJsonSchema,
  collectPublishBlockers,
  CourseJsonDocumentSchema,
  InvalidLessonRoleComboError,
  IncompleteVideosError,
  MissingVideoAssetReceiptError,
  InvalidVideoAssetReceiptError,
  type BuildCourseJsonInput,
  type CourseJsonDocument,
  type IncompleteVideo,
  type InvalidLessonCombo,
  type VideoAssetReceipt,
  type PublishBlockers,
} from "./lib/build-course-json";

export {
  computeEffectiveSections,
  isLessonEffective,
  isLessonWithheld,
} from "./lib/effective-sections";
