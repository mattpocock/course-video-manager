---
status: accepted
---

# A Clip Mockup Chapter is a divider in the Clip Mockups' own order space, not a parent of them

An **Animatic** is long: a Lesson mocked at one **Clip Mockup** per spoken paragraph runs to sixty rows, and the Animatic page shows every one of them as a flat list. There was no way to read the shape of the Lesson off that list, and no way to fold away a settled run of twenty rows. A filmed **Video** has had the answer for a long time — its timeline groups **Clips** under **Chapters**, which collapse one at a time or all at once — so the Animatic gets the same shape one rung lower on the fidelity ladder: a **Clip Mockup Chapter**, a named divider that groups the Clip Mockups below it.

The decision is how that grouping is stored. A Clip Mockup Chapter is its own table (`clip_mockup_chapter`: `id`, `videoId`, `name`, `order`, `archived`, `createdAt`), and its `order` is a **Fractional Index** in the SAME key space as `clip_mockup.order`. One sorted list holds both kinds of row. There is NO `chapterId` on a Clip Mockup, and no foreign key in either direction between the two tables. The table mirrors the `chapter` table's column shape on purpose, but it has no relation to it: the two nouns never meet.

## Why this shape

- **A shared order space makes the grouping unforgeable.** Membership is read from the one list every surface already sorts: a Clip Mockup belongs to the last Chapter above it. A parent id is a second copy of that fact, and a second copy can disagree with the first. With one key space there is no state that can go stale, so a move re-parents nothing and no repair code is needed.
- **Inserting a divider is one write.** A Chapter goes between two moments by taking a key between their two keys. Nothing is renumbered, and the anchor flags (`--before` / `--after`) accept ANY id in the space — a Clip Mockup id or another Chapter id — because the space is one space.
- **The primitive already existed.** `orderKeyBeforeItem` computes a key against a merged, sorted list of two nouns, which is exactly what **Chapter** and **Clip** already do on the filmed timeline. It is reused unchanged. What is new is one shared read — `listAnimaticOrder(videoId)`, which returns `{ type, id, order }` rows of both kinds — and all four positioning paths (create a Chapter, move a Chapter, create a Clip Mockup, move a Clip Mockup) read it. One list, one sort, one set of keys.
- **Clip Mockups above the first divider need no heading.** They belong to no Chapter. That is a real state, not a gap, so a run of unchaptered moments is rendered as plain rows and no synthetic "Untitled" Chapter is invented.
- **A Chapter is navigation, not plan.** It holds a title and a position and nothing else — no body, no kind, no count. Everything a reader wants from it (the Clip Mockup count, the run time, the frame to seek to) is arithmetic over the rows between it and the next divider, so it is computed, never stored, and it can never be wrong.

## No link to a Beat

A Clip Mockup deliberately does not point at a **Beat**: one that serves no Beat is a real and useful thing, because it means the plan missed a moment. A Chapter must not put that link back. There is no `beatId` on a Clip Mockup Chapter, and a title is not a smuggled one — it names a coarse part of the plan for the author, never a Beat and never a **Learning Goal**. A Chapter that mirrored the Beats one-for-one would make the Animatic a second, weaker copy of the Beat plan, and the first divergence between the two would be a bug with no owner.

## Consequences

- **Deleting a Chapter absorbs its Clip Mockups upward with no write.** Delete is an **Archive** of the Chapter row and touches nothing else. The same implicit rule then puts its Clip Mockups in the Chapter above it — or leaves them unchaptered, if it was the first. So an organisational verb can never destroy hours of frames and synthesised speech, and the outcome needs no rule about orphans.
- **Appending a Clip Mockup now lands INSIDE the last Chapter.** The external behaviour of `cvm clip-mockup add` is unchanged (append, or place against a named row), but its key is computed in the merged space. This is what makes "open a Chapter, then keep adding moments into it" the natural authoring shape.
- **The playback and the position badge do not change.** A Chapter is never a segment: it is not on the canvas, it adds no time, and the position badge still counts Clip Mockups only — so the number the author reads off the screen is still the number he says out loud and the number `--at` takes. A Video with no Chapters reads exactly as it did before.
- **Every read must exclude archived rows of BOTH kinds.** A merged list built from two tables has two archive filters, not one. Forgetting one puts a deleted divider back in the middle of an Animatic.
- **The three copy paths must copy in the merged space.** A version snapshot, a duplicated Video and a duplicated Course all carry a Video's Chapters beside its Clip Mockups. The Video-copy path regenerates order keys, so it generates them across the MERGED list and hands each row back its own key; copying the two tables independently would pile every divider at one end. Like a Clip Mockup, a Chapter is internal and never reaches `course.json`.
- **The UI never writes one.** The Animatic page reads Chapters and collapses them; `cvm clip-mockup-chapter` is the only write path. This is why the Mockups side-panel tab went at the same time: a second write path into this list could move a row across a boundary the author cannot see.

## Two deliberate asymmetries

Both are stated in `cvm clip-mockup-chapter --help` and in `CONTEXT.md`, because both look like bugs to an agent that assumes the noun inherits from its neighbours.

- **No Draft Course Version guard.** Every `clip` and `chapter` write needs the owning Course Version to be a Draft. No Clip Mockup Chapter write does. That guard protects the published Course Version write-closure, and Clip Mockups sit outside it — so their grouping follows the thing it groups, not the thing it resembles.
- **Not a Local-only Command.** Every `cvm clip-mockup` verb is refused off the author's machine, because a frame and a WAV are a directory there (see [ADR 0025](0025-local-remote-split-one-http-transport.md)). A Chapter is a row and touches no disk, so every verb works from any box with a token, including the Remote Box. `cvm clip-mockup-chapter list` therefore works where `cvm clip-mockup list` beside it is refused.
