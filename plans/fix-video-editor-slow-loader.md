# Fix: Video editor 8-second page load caused by `getNextVideoId` / `getPreviousVideoId`

## Context

The video editor page takes 8+ seconds to load. Profiling revealed the bottleneck is in the layout loader (`app/routes/videos.$videoId.tsx`), specifically `getNextVideoId` (4.3s) and `getPreviousVideoId` (4.0s). These functions load the **entire course tree including all clips** via `getCourseWithSectionsById` just to find two video IDs for prev/next navigation. They also redundantly call `getVideoWithClipsById` (already fetched by the layout loader).

## Approach

1. Create a lightweight `getCourseNavigationData(courseId)` query that fetches only what navigation needs (sections → lessons → videos with just IDs/paths/fsStatus — **no clips**, latest version only)
2. Refactor `getNextVideoId` / `getPreviousVideoId` to accept the already-fetched video data and use `getCourseNavigationData` instead of `getCourseWithSectionsById`
3. Update the layout loader to pass video data and run both in parallel

## TDD Cycles

### Test file: `app/services/db-service-video-navigation.test.ts`

Setup follows `db-service-clip-ordering.test.ts` pattern: PGlite in `beforeAll`, `truncateAllTables` in `beforeEach`, domain operations service layer.

Fixture helper: `buildCourseFixture(testDb, { sections: [...] })` — inserts course → version → sections → lessons → videos using direct Drizzle inserts (pattern from `course-editor-service-test-setup.ts:createCourseWithVersion` + `createSectionWithLessons`).

### Cycle 1: Standalone video → null

- **RED**: `getNextVideoId` with standalone video returns null
- **GREEN**: Refactor to accept video param, check `!video.lesson`

### Cycle 2: Next video in same lesson

- **RED**: Lesson with videos [a.mp4, b.mp4, c.mp4], call with b → expect c's ID
- **GREEN**: Sort `video.lesson.videos` by path, find next

### Cycle 3: Previous video in same lesson

- **RED**: Same fixture, call `getPreviousVideoId` with b → expect a's ID
- **GREEN**: Same logic in reverse

### Cycle 4: Cross-lesson navigation (next)

- **RED**: Two lessons each with 1 video, at end of lesson 1 → expect first video of lesson 2
- **GREEN**: Implement `getCourseNavigationData` (no clips, latest version only, `limit: 1`), wire into `getNextVideoId`

### Cycle 5: Cross-lesson navigation (previous)

- **RED**: Same fixture, at start of lesson 2 → expect last video of lesson 1
- **GREEN**: Wire `getCourseNavigationData` into `getPreviousVideoId`

### Cycle 6: Skips non-real lessons

- **RED**: Ghost lesson between two real lessons is skipped
- **GREEN**: Filter `fsStatus === "real"` (already in logic)

### Cycle 7: Crosses section boundaries

- **RED**: Two sections, navigate from last video of section 1 to first of section 2
- **GREEN**: flatMap over sections (already in logic)

### Cycle 8: Null at course boundaries

- **RED**: First video in course → prev is null; last video → next is null
- **GREEN**: Loop exhaustion returns null (already in logic)

### Cycle 9: Skips archived videos

- **RED**: Archived video in next lesson is skipped
- **GREEN**: `where: eq(videos.archived, false)` in query

## Files to modify

| File                                               | Change                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `app/services/db-service-video-navigation.test.ts` | **New** — test file                                                   |
| `app/services/db-course-operations.server.ts`      | Add `getCourseNavigationData` query                                   |
| `app/services/db-video-operations.server.ts`       | Refactor `getNextVideoId`/`getPreviousVideoId` signatures + internals |
| `app/services/db-service.server.ts`                | Wire up new function, pass `getCourseNavigationData` to video ops     |
| `app/routes/videos.$videoId.tsx`                   | Pass video data, run next/prev in parallel via `Effect.all`           |
| `app/routes/videos.$videoId.write.tsx`             | Same loader changes (also calls these functions)                      |

## Key implementation details

- `getCourseNavigationData` goes in `db-course-operations.server.ts` next to `getCourseWithSectionsById`
- Query shape: `courses.findFirst` with `versions: { limit: 1 }` → `sections` → `lessons` → `videos` (columns: `{ id: true, path: true }` only, no clips relation)
- `getNextVideoId` / `getPreviousVideoId` new signature: accept `{ id, lesson: { id, videos, section: { repoVersion: { repo: { id } } } } | null }` — the shape already returned by `getVideoWithClipsById`
- Pass `getCourseNavigationData` as a dependency from `createVideoOperations` (same pattern as `getCourseWithSectionsById` is passed today)
- Layout loader: `const [nextVideoId, previousVideoId] = yield* Effect.all([db.getNextVideoId(video), db.getPreviousVideoId(video)])`

## Verification

1. Run `npx vitest app/services/db-service-video-navigation.test.ts` — all tests pass
2. Build and load a video editor page — response time should drop from ~8s to <200ms
3. Verify prev/next navigation buttons still work correctly
4. Remove all timing instrumentation added during investigation

## Cleanup (after fix is verified)

Remove timing instrumentation from:

- `app/routes/videos.$videoId.edit.tsx` (loader timing, Component timing)
- `app/routes/videos.$videoId.tsx` (layout loader timing)
- `app/features/video-editor/video-editor.tsx` (render timing)
- `app/features/video-editor/components/clip-item.tsx` (render counter + timing)
- `app/features/video-editor/components/video-player-panel.tsx` (render start log)
- Revert the SSR test bypass in `clip-item.tsx` (the early return with simplified JSX)
- Revert the Component bypass in `videos.$videoId.edit.tsx`
