---
name: optimize-loader
description:
  "Optimize slow React Router loaders by eliminating redundant DB queries, creating slim query variants, and parallelizing independent fetches.
  Use proactively when writing or reviewing loader code that calls domain operations services (e.g. CourseOperationsService, VideoOperationsService), or when triaging a slow page load."
---

# Optimize Loader

## Anti-patterns to catch

### 1. Re-fetching data the caller already has

If a loader fetches a record (e.g. `getVideoWithClipsById`) and then passes just the **ID** to a downstream function that re-fetches the same record internally — change the downstream function's signature to accept the already-fetched object.

```typescript
// BAD — getNextVideoId internally calls getVideoWithClipsById again
const video = yield * db.getVideoWithClipsById(videoId);
const nextId = yield * db.getNextVideoId(videoId);

// GOOD — pass the already-fetched video
const video = yield * db.getVideoWithClipsById(videoId);
const nextId = yield * db.getNextVideoId(video);
```

When refactoring signatures, type the parameter as the minimal shape needed, not the full return type:

```typescript
// Accept only what the function actually reads
function* (currentVideo: {
  id: string;
  lesson: {
    id: string;
    videos: Array<{ id: string; path: string }>;
    section: { repoVersion: { repo: { id: string } } };
  } | null;
})
```

### 2. Over-fetching nested relations

If a function only needs IDs and paths for navigation but loads full nested trees including clips, transcripts, etc. — create a slim query variant.

```typescript
// BAD — loads clips, chapters, thumbnails etc. just to get video IDs
const course = yield * getCourseWithSectionsById(repoId);

// GOOD — dedicated lightweight query
const course = yield * getCourseNavigationData(repoId);
```

Slim query checklist:

- `columns: { id: true, path: true }` — only select needed columns on leaf relations
- `limit: 1` on relations like versions where you only need the latest
- Omit `with:` for relations you don't traverse (clips, chapters, thumbnails)
- Keep `where:` filters (e.g. `archived = false`) and `orderBy` intact

### 3. Sequential independent queries

If a loader runs multiple independent DB calls sequentially, parallelize with `Effect.all`:

```typescript
// BAD — sequential, total time = sum of both
const nextVideoId = yield * db.getNextVideoId(video);
const previousVideoId = yield * db.getPreviousVideoId(video);

// GOOD — parallel, total time = max of both
const [nextVideoId, previousVideoId] =
  yield * Effect.all([db.getNextVideoId(video), db.getPreviousVideoId(video)]);
```

## Dependency injection pattern

When adding a new query (like `getCourseNavigationData`) that lives in course operations but is used by video operations:

1. Add the query to `db-course-operations.server.ts` and export it
2. Declare the cross-domain dependency in `VideoOperationsService`'s `effect` block via `yield* CourseOperationsService`
3. The Effect Layer system resolves cross-domain dependencies automatically
