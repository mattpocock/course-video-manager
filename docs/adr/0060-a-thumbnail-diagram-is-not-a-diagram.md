# A Thumbnail Diagram is not a Diagram

A **Thumbnail** gets its drawing edited in place, beside the author's face, so it needs a tldraw scene of its own. We considered making that scene part of the Diagram model: the Thumbnail pins a **DiagramSnapshot** the way a **Clip** does (ADR 0003's Video : Clip pattern), forked from a Diagram's head on save. That would have given thumbnails search, the Snapshot Timeline and reuse for free. Decision: keep the streams separate. A Thumbnail owns a **Thumbnail Diagram**, a tldraw `document` (same format as `headScene` and snapshot scenes) that is edited in place, has no snapshots, does not appear in Playground Home, and is never subject to the Snapshot Rule. It shares everything at the tldraw level: `CVM_SHAPE_UTILS`, Diagram Components (inserted and saved, as in the playground), Icons, rendering.

We chose this because a thumbnail has no Clips, so the snapshot machinery would only add rules to think about without telling us anything, and because Diagrams are vector-only (ADR 0003, "Asset policy for v1") while a Thumbnail Diagram may need image shapes for the face. We also had no concrete use case for keeping thumbnails inside the Diagram model.

The model must not lose information. A Thumbnail Diagram starts empty, and whenever shapes are copied into it from a Diagram, a DiagramSnapshot or another Thumbnail Diagram, it records each source. Copying from a Diagram's head first pins that head as an unpreserved DiagramSnapshot (content-hash deduped, hidden from the timeline, never hard-deleted), so the record points at exactly what was copied rather than at a head that keeps moving. That keeps a later merge cheap: both sides store the same JSON, so turning Thumbnail Diagrams into Diagram rows is a migration, not a rewrite. Separating the two after mixing them would be the hard direction.

## Consequences

- The thumbnail editor and the Diagram Playground are the same editor: same Diagram Component search and save, same Icon handling, same way of finding Diagrams and DiagramSnapshots. Two subtly different diagram editors would be a constant paper cut.
- There is one search across both editors: it finds Diagrams, DiagramSnapshots and Thumbnail Diagrams (each labelled with its Video) from the playground and from the thumbnail editor alike. A result can be opened where it lives or inserted onto the current canvas.
- The face belongs to the Thumbnail, never to its Thumbnail Diagram. While editing, the editor holds the face alongside the drawing so both share one undo history, but saving splits them: the face goes to the Thumbnail's layers and the Thumbnail Diagram is saved as drawing only, so it can be inserted elsewhere without a face in it.
- Thumbnails are archived, never hard-deleted, so a recorded source keeps resolving.
- Deliberate gap: shapes pasted in through tldraw's clipboard record no source. Making the clipboard carry a Diagram id was judged not worth the complexity.
