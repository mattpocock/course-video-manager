---
status: superseded by 0018-db-only-courses
---

# Ghost Lessons are full video workspaces, not empty placeholders

A **Ghost Lesson** exists in the database but has no folder on disk (`fsStatus = "ghost"`). With Segments now a video-level planning structure (ADR 0015), we decided a Ghost Lesson is a **complete planning and recording workspace**: it can hold **Videos**, **Segments**, and **Clips** exactly as a real lesson can. None of those touch the filesystem, so nothing about the ghost state needs to block them.

## Why this shape

- **Recording is filesystem-free, so the restriction would be artificial.** Creating a Video is a pure DB insert (`createVideo`), and recording a Clip writes only DB rows — a `videoFilename` (pointing at source footage that lives wherever it was recorded, _not_ the lesson folder) plus a time range. The lesson's on-disk directory is needed only as the _destination_ for the final concatenated export, and Publish already skips ghost lessons. So a Video on a Ghost Lesson is just a fully-working video whose export destination doesn't exist yet — identical to how Segments never publish.

- **Dematerializing must therefore preserve Videos.** `convertToGhost` deletes the lesson's on-disk directory and flips the row to `fsStatus = "ghost"` — it updates the lesson, it does not delete it, and it never touches the `videos`/`clips`/`segments` tables. The planning structure and clip definitions survive a round-trip; only physical files in the folder (notably exported output) are lost. Re-materializing brings the folder back empty, and the preserved clips re-export — clips are the source of truth, exported output is derived.

## Considered alternatives

- **Block recording until materialized** (Video on a ghost is a name-and-segments placeholder only). Rejected: it adds a guard that buys no safety — Publish already protects disk — while forbidding a genuinely useful workflow (plan and record a lesson before committing it to disk).
- **Keep the old "remove videos before converting to ghost" block.** This was the prior behaviour: the Convert-to-Ghost modal disabled conversion whenever the lesson had any Video. It made sense when a Video was an on-disk producible artifact, but it directly contradicts the model above, so it was removed.

## Consequences

- The `hasVideos` guard is gone from the Convert-to-Ghost modal; the `filesOnDisk` warning (which lists files physically deleted, including exported output) stays, and the confirm button still reads "Delete Files & Convert" when files are present.
- A lesson with recorded videos can now be dematerialized; the videos reappear as "unexported" on re-materialize.
- There is no server-side video guard to remove — `convertToGhost` never had one; the UI block was the only gate.
