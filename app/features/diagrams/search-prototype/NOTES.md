# PROTOTYPE — Diagrams search-box UI (wayfinder #135)

Throwaway. Delete once the design is chosen and folded into
`app/routes/diagram-playground._index.tsx`.

## Question (ticket #135)

Design the search box on the Diagrams page: placement, interaction
(live-as-you-type vs submit, client vs server), empty/no-results states, and how
it composes with the existing name filter. Result SHAPE is already locked by
#131 (snapshot-grain, grouped under diagram, head shown as "Current", recency
order, no rank) — this prototype is about the **surface**, not the query.

## How to run

```
pnpm install         # once, in this worktree
pnpm dev             # then open the diagram-playground iframe / route
```

Flip variants with the floating green bar (bottom-centre) or ←/→ keys. The
`?variant=A|B|C` param is shareable. Type in the search box to see fabricated
results — the tsvector backend doesn't exist yet, so `stub-data.ts` FABRICATES
matches (honouring #131's shape). Match highlighting is intentionally absent
(deferred out of v1 per the map).

## The three variants

- **A — Reflow-in-place grouped rows.** One inline search box in the header
  absorbs the name filter (searches name + content, no mode toggle). On query
  the grid becomes a vertical stack of per-diagram groups, each a strip of its
  matched snapshot cards. Closest to the current page.
- **B — Two-pane master/detail.** Prominent top bar; results split into a left
  rail of matching diagrams (name + count) and a right pane of snapshot cards.
  Best when one diagram has many matching snapshots. Name filter dropped.
- **C — Flat snapshot stream + scope toggle.** Centred search with an explicit
  Both/Name/Content segmented control (composition made user-controllable). One
  flat recency-ordered grid, diagram name shown as a chip per card. Best when
  matches are spread thin across many diagrams.

Shared interaction across all three (a proposal, not yet locked): live-as-you-
type, 200ms debounce, server round-trip against the GIN index.

## VERDICT

_Pending Matt's reaction. Likely outcome is "the box from X with the results
layout from Y" — capture that, then fold the winner in and delete the rest._
