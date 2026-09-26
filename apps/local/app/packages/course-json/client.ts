// Entry point (public, browser-safe) for the course-json package.
//
// WHY A SECOND ENTRY POINT. `index.ts` re-exports `lib/build-course-json`,
// which reaches `services/export-hash` for the Export Hash, which imports
// `node:crypto` and `node:path`. Every one of those is correct on a server and
// none of it can run in a browser — so a single component importing
// `PLACEHOLDER_FLOOR_BANDS` from `index.ts` pulled the whole manifest builder
// into the client bundle and made Vite externalize two node builtins for it.
//
// This is the split the packages README asks for: several small entry points
// rather than one barrel that funnels a whole subtree. The dividing line is not
// "types vs. values" — a type import is erased either way — it is WHERE THE CODE
// CAN RUN. Everything re-exported here comes from `lib/lesson-publish-status`,
// which imports nothing at all, so it runs in either place.
//
// Import THIS from a component, a route's default export, or anything else that
// is sent to the browser. Import `index.ts` from a loader, an action, a service
// or the CLI, where the manifest builder is the point.
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
} from "./lib/lesson-publish-status";

// The effective-output filters are the classifier applied to the tree, and
// `lib/effective-sections` imports nothing but `lib/lesson-publish-status` — so
// they run wherever the classifier does. `autofill-candidates` needs
// `computeShippingSections` and is itself read by a component, which is the
// second way the manifest builder used to reach the browser.
export {
  computeEffectiveSections,
  computeShippingSections,
} from "./lib/effective-sections";
