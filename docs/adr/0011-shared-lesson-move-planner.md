---
status: superseded by 0028-drop-numbered-path-prefix
---

# Lesson moves are computed by a shared pure planner, executed server-side and replayed optimistically

Moving a real **Lesson** between **Sections** is not an FK update — it renames the lesson's folder on disk, renumbers the source section's remaining lessons to close the gap, **materializes** a ghost target section, **dematerializes** a source section emptied by the move, and renumbers every section's path prefix. The on-disk number (`NN.MM.slug`) is positional and counts real lessons only, while the `order` field orders ghost + real lessons together; both are surfaced in the course view (the `NN.MM.` prefix renders next to each lesson title). To let the user drag a lesson to a precise slot between two lessons in another section, the move event carries a `beforeLessonId: string | null` anchor (`null` = end), and the optimistic UI must reproduce the **entire** renumbering cascade, not just the single moved lesson — otherwise visible numbers snap on server reconciliation.

We therefore extract the _planning_ of a move out of `moveToSection` (in `course-write-service.ts`) into a pure function — `planLessonMove(sections, { lessonId, targetSectionId, beforeLessonId }) → { lessonUpdates, sectionUpdates, fsOps }`. The server runs the planner, then executes `fsOps` (filesystem) and applies the updates to the database; the client optimistic applier runs the **same** planner and applies `lessonUpdates` / `sectionUpdates` to loader data, ignoring `fsOps`. One algorithm, two consumers.

## Why this shape

- **A full optimistic cascade is only safe with a single source of truth.** We chose to mirror the server's cascade in the optimistic UI (so the dragged lesson lands with its correct number and source siblings renumber immediately, rather than snapping). A hand-written second copy of the numbering/materialization logic in the applier would drift from the server, and a drifted optimistic state showing confidently-wrong numbers is worse than a clean snap. Extracting one pure planner both consumers import removes the second source of truth.
- **Separating plan from IO makes the server logic testable without a filesystem.** `moveToSection` currently interleaves planning, `node:fs` calls, and DB writes in one imperative `Effect.fn`. The planner is pure data-in/data-out, so the cascade rules (which lesson gets which path, which sections materialize/dematerialize, which prefixes renumber) become unit-testable directly.
- **The `beforeLessonId` insertion logic has one natural home.** Position resolution — anchor → `order` between neighbours → on-disk `MM` from real-lessons-before — lives in the planner, computed once and consumed by both sides.

## Considered alternatives

- **Hand-mirror the cascade in the optimistic applier.** Rejected: guaranteed drift between two implementations of the same algorithm.
- **Move-then-reorder** (fire `move-lesson-to-section` then `reorder-lessons`). Rejected: two filesystem-mutating round-trips and two `runValidation` runs per drag, plus a visible intermediate state where the lesson flashes at the bottom of the target before jumping to its slot.
- **Position-only / partial optimism** (renumber nothing, or only the moved lesson). Rejected for this feature: the `NN.MM.` prefix renders directly under the cursor at the drop point, so a number snapping there reads as a bug in a way a post-context-menu snap does not.

## Consequences

- `reorderLessons` has the same plan/IO/DB shape and should be refactored onto the same planner seam for consistency (follow-up, not required by the first cut).
- The planner must stay the authority for numbering; any future change to numbering rules changes one function and both server and optimistic behaviour move together.
