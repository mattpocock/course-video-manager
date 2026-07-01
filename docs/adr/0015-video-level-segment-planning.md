---
status: accepted
---

# Segments are a video-level planning structure, separate from Chapters

We want to plan the content of lessons and pitches _inside_ the app, replacing the scratch-markdown files and the free-text pitch plan. The chosen model is the **Segment**: a film-time planning unit classified by its job, drawn from the Mise en Place glossary's five kinds — **Definition**, **Walkthrough**, **Playthrough**, **Quest**, **Reaction**. A Video's plan is an ordered sequence of Segments. See `Segment` in `CONTEXT.md`.

A Segment is a new first-class entity with a mutable parent **Video** FK, a required `kind` (defaulting to `Definition`), a `title`, and a string fractional-index `order` (the same `varcharCollateC` pattern as clips/chapters). It carries no body, no mode, and no published footprint.

## Why this shape

- **Segments belong to the Video, not the Lesson or Pitch.** A single Pitch can spawn two slightly-different Videos, and we want to plan each independently; a single Lesson can hold more than one Video. Hanging the plan on the planning container (Lesson/Pitch) would force one shared plan where we need one per Video. Duplicating a Video therefore copies its Segments, and a Segment can be dragged from one Video's plan into another's (reassigning its parent) — a cross-container move identical in shape to a cross-section lesson move (ADR 0011/0013), which is why Segments reuse the string fractional index rather than the float `order` lessons use.

- **A Segment is _not_ a Chapter, despite both being ordered named units in a Video.** A **Chapter** is a recorded-timeline grouping that maps 1:1 to YouTube and groups Clips; a Segment is the _intended_ structure, authored before any footage exists. We considered extending Chapter (adding a `kind`) or having Segments seed Chapters, and rejected both: it would overload Chapter's crisp 1:1-to-YouTube meaning (the glossary explicitly warns against that), and it would break planning on a pitch Video that has zero clips and zero chapters. Segments and Chapters are deliberately two views — "what I planned to shoot" vs "what I shot" — that never reconcile.

- **Internal-only, but copied forward at version time.** Segments never appear in published output, the transcript, or the changelog — they are pre-production scaffolding. But `copyVersionStructure` clones videos/clips/chapters on every Publish, so Segments must ride along in that copy; otherwise a lesson Video's plan would evaporate the moment the author publishes mid-draft. Pitch Videos are not version-scoped, so this only affects lesson Videos.

## Consequences

- A new `segments` table with a `videoId` FK, `kind`, `title`, and `varcharCollateC` `order`; `copyVersionStructure` gains a Segment-copy step keyed off the existing `videoIdMappings`.
- `pitches.contentPlan` is retired (no longer written). Where non-empty it is shown read-only in the UI as a transitional reference, then dropped later.
- Segments **hard-delete** rather than archive — a deliberate exception to this app's archive-everything norm, justified because a Segment has no published footprint, no changelog history, and nothing downstream depends on it.
- The compact course view gains a text tree (lesson → videos → segments); the expanded view keeps its thumbnail grid and shows no segments. Segments are authored via the existing video context menu (five kind choices, each with a distinct icon) and renamed inline.

## Divergence from implementation (soft-delete, not hard-delete)

> **Flagged, not silently overridden** (per `docs/agents/domain.md`). The hard-delete decision above was **not** realised in code: `deleteSegment` in `app/services/db-segment-operations.server.ts` sets `archived: true`, and `listSegmentsByVideoId` filters on `archived: false`. In practice a deleted Segment is soft-deleted (archived) — it is filtered out of every read and can never be re-addressed, so it is functionally equivalent to a delete, but the row survives. The `cvm segment delete` help text and `CONTEXT.md` describe this implemented soft-delete behaviour. This ADR's "hard-delete" wording is therefore stale; resolving it (either changing the code to hard-delete, or amending this decision) is left as a follow-up.
