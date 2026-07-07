---
status: accepted
supersedes-naming-of: 0015-video-level-segment-planning
---

# Adopt "Beat" as the name for the film-time planning unit

The entity introduced in [ADR 0015](0015-video-level-segment-planning.md) as **Segment** is renamed to **Beat**. ADR 0015's structural decisions (video-level ownership, separation from Chapters, five kinds from the Mise en Place glossary) are unchanged — only the name moves.

## Why rename

"Segment" was overloaded. In this codebase, the word also means:

- A **transcription segment** — a Whisper `{start, end, text}` span (used in `video-processing-service.ts`, `clips.transcribe.ts`, and the hard external-API literal `timestamp_granularities: ["segment","word"]`).
- A **path segment** — the result of splitting a filesystem path (`vfs-path.ts`, `vfs-tree.ts`).
- A **speech/silence segment** — the conceptual unit in the silence-detection subsystem.

Readers had to distinguish "Segment the planning unit" from "segment the transcription span" on context alone. Extending either concept risked a naming collision.

## Why "Beat"

"Beat" reads naturally in the screenwriting sense: a narrative unit of story/action — which is exactly what a planning unit classified by its job (Definition, Walkthrough, Playthrough, Quest, Reaction) represents. The glossary previously rejected "Beat" (`_Avoid_: Beat`) for two reasons:

1. **The `clip.beatType` collision** — the clip-level held-pause field was named `beatType`. This is now resolved: `beatType` was renamed to `pauseType` (the clip field is now called **Pause**).
2. **"A narrative-unit synonym rejected upstream"** — reversed on purpose, because the narrative-unit reading is exactly what fits the planning unit's role.

With both grounds cleared, "Beat" is the strongest available name.

## Cascade

This rename was the third step in a load-bearing cascade, each freeing the word the next one needed:

1. Session **Pause Length → Silence Length** — freed the word "Pause".
2. Clip **`beatType` → Pause** — freed the word "Beat".
3. **Segment → Beat** — adopted "Beat" for the planning unit.

Source: `docs/segment-beat-pause-rename-spec.md` (wayfinder map #1137).

## Consequences

- The DB table is `course-video-manager_beat`; Drizzle relation `beats`.
- The CLI noun is `cvm beat` (verbs unchanged).
- The feature directory is `app/features/beats/`.
- Type/constant families: `BeatKind`, `BEAT_KINDS`, `BEAT_KIND_LABELS`/`_ICONS`/`_DESCRIPTIONS`, `DEFAULT_BEAT_KIND`.
- The glossary term is **Beat**; the planning note is **Beat Description**.
- "Segment" survives in the codebase only as the transcript/silence/path homonym — those occurrences were deliberately not renamed.
- ADR 0015's structural reasoning (video-level, separate from Chapters, soft-delete divergence) remains in force under the new name.
