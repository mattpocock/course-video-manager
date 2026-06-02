---
status: accepted
---

# Bulk lesson reorder is within-section-only and collapse-to-contiguous

When the user multi-selects lessons and drags them to a new position, the operation is constrained to a single section: all selected lessons must belong to the same section, and the drop target must also be within that section. Cross-section bulk moves are not supported in v1.

The drop always **collapses** a non-contiguous selection into a contiguous block at the drop anchor. Selected lessons are spliced out of the section's lesson-id array and re-inserted together, preserving their relative order. If the resulting array is identical to the original (the selection was already contiguous at that position), the drop is a no-op.

## Why this shape

- **Within-section simplifies the reorder event.** The existing `reorder-lessons` event accepts a single `sectionId` + `lessonIds[]` and is already handled optimistically and on the server. A cross-section bulk move would require a new event type, a planner extension to handle multi-lesson materialisation/dematerialisation cascades, and multi-section renumbering — substantial complexity with unclear user demand.
- **Collapse-to-contiguous is the only unambiguous interpretation.** When a non-contiguous set (e.g. lessons 1, 3, 5) is dropped before lesson 4, the user expects them to land together. Preserving the gaps (keeping the unselected lessons interleaved) would require the user to reason about two orderings simultaneously. Collapsing and preserving relative order is the behaviour users expect from multi-select reorder in Finder, Notion, and similar tools.
- **The selection model already enforces single-section.** `lessonSelection` tracks one `sectionId` and resets when the user clicks a lesson in a different section, so the bulk drag handler can rely on all selected IDs belonging to one section without additional validation.

## Consequences

- Cross-section bulk move is a separate future feature, not an extension of this one. It would require a new event (`move-lessons-to-section`) and a multi-lesson planner.
- The v1 drag preview shows a single-lesson reflow rather than a multi-lesson gap. The committed result is correct; only the mid-drag animation is approximate.
