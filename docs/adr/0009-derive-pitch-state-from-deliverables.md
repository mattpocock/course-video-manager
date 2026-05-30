---
status: accepted
---

# Derive Pitch visibility from linked Deliverable status

## Context

A **Pitch** carried a manual five-value `status` (`idle → scheduled → shipped-to-youtube → shipped`, plus a sideways `cancelled` off-ramp), set by hand and used mainly to hide finished pitches from the index's **Default Pitch Filter**. The field had to be maintained manually and drifted out of sync with reality: a pitch was "really" done once the work scheduled on the **Deliverables Calendar** was done, yet the pitch's own status had to be flipped separately.

A Pitch already links to zero-or-more **Deliverables** (many-to-many via `deliverable_pitch`), and a **Deliverable** already has a manual `planned | done | cancelled` status that drives the calendar. The information needed to know whether a pitch is "done" therefore already lived on its Deliverables.

## Decision

Delete the `status` column on Pitch. Derive a **Pitch State** live from the **Deliverable Status** of the Deliverables linked to the pitch — never stored — as a three-way partition of every non-archived pitch:

- **Idle** — no linked Deliverable.
- **Scheduled** — at least one linked Deliverable, but not all terminal.
- **Shipped** — at least one linked Deliverable, and every one terminal (`done` or `cancelled`).

Visibility is binary: **Idle + Scheduled** show by default; **Shipped** is hidden behind a single reveal toggle, mirroring the calendar's "show cancelled/shipped" disclosure. Abandonment is handled by the existing **Archive** flag — an orthogonal axis, not derived.

## Considered alternatives

- **Keep the manual status, add a derive-on-top sync.** Rejected: the manual upkeep was the whole problem; a sync that can disagree with the Deliverables is just a second source of truth.
- **Derive a richer status (cancelled vs done) from deliverable kinds.** Rejected: a pitch could then become "cancelled" as a side effect of editing the calendar, with no deliberate human decision. We kept `cancelled` as an explicit act → **Archive**.

## Consequences

- This **amends ADR-0007**: Deliverable links are no longer purely "informational." A Pitch's visibility is now derived across the link, while the Deliverable's _own_ state remains underived.
- Two former states are gone by design. `shipped-to-youtube` is now expressed as one terminal + one non-terminal Deliverable (the pitch stays **Scheduled**, correctly "not done"). The manual `cancelled` off-ramp is now **Archive**.
- **No backfill.** Dropping the column means existing pitches that were manually marked `shipped`/`cancelled` but never linked to a Deliverable resurface as **Idle**. These get cleaned up by archiving them by hand — accepted as a one-time cost rather than a migration.
- The deliverable-form pitch picker groups by the same three derived states; status is no longer a stored field anywhere in the UI.
