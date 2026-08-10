---
status: accepted
---

# Deliverables are agent-writable, and that leaves them manual

`cvm deliverable` gains `create` / `update` / `archive`, so an agent — not just
Matt in the app — can author the **Deliverables Calendar**. **Deliverable
Status** stays underived.

## Context

**ADR-0007** made the Deliverables Calendar "manual and informational", and
**ADR-0009** amended it: a **Pitch State** is now derived across the link, while
a Deliverable's own state stays manual. Between them, "manual" is doing two
different jobs:

1. **Not derived** — a Deliverable's `date` and `status` are set by a deliberate
   act, never computed from a linked Pitch or Course. This is what ADR-0007
   actually decided, and its whole justification (entries pre-date the entities
   they describe, get moved speculatively, and bundle several items under one
   ship date) is about _derivation_, not about who is holding the keyboard.
2. **Hand-typed by a human in the UI** — an incidental fact about the only write
   surface that existed when 0007 was written.

An external scheduling agent now needs sense (1) to hold and sense (2) to stop
holding. `deliverables.date` is the **only date-of-intent in the CVM schema** —
no Course, CourseVersion, Section, Lesson, Video or Pitch carries a deadline — so
any agent that plans Matt's time has to read and set it here or invent a second,
divergent deadline store.

## Decision

Give `cvm deliverable` write verbs. An agent writing a Deliverable through the
CLI is the **same deliberate authoring act** as Matt editing the calendar in the
app: one row, one explicit intent, echoed back. Nothing about it computes a
Deliverable's state from another entity, so ADR-0007's decision is untouched —
this ADR narrows its wording from "manual" to "underived".

Consequences of that framing, made explicit in the CLI surface:

- **No propagation is added in either direction.** Setting `--status done` does
  not touch a linked Pitch's stored state (there isn't one — ADR-0009 deleted
  it); it changes what the derived Pitch State computes to, which is exactly
  what the UI already does.
- **All transitions stay reversible.** `done` and `cancelled` are terminal _for
  Pitch State derivation_, not immutable. The CLI refuses to pretend otherwise:
  `update --status planned <id>` reopens a Deliverable.
- **Archive is still the only hide**, and it is exposed as its own verb so an
  agent cannot reach for `cancelled` to make something disappear.
- **Writes are backup-coordinated** like every other `cvm` write: the server
  must be up, and a dump is requested afterwards. Agent authorship gets no
  weaker durability guarantee than human authorship.
  _(Superseded: the domain database is hosted and backup coordination was
  deleted — durability is now the host's point-in-time recovery, and a `cvm`
  write no longer needs the server up. See issue #1536.)_
- **Archive is exposed even though it is a one-way door.** Nothing un-archives a
  Deliverable anywhere in the product — no CLI verb, no HTTP route, no UI
  action — so `cvm deliverable archive` hands an agent an irreversible hide.
  This is a pre-existing gap the CLI now makes reachable, not one it creates.
  We expose it anyway, because withholding it would push agents toward
  `cancelled` as a pseudo-delete and corrupt the meaning of a status the
  calendar displays. The `--help` says plainly that it cannot be undone.

## Considered alternatives

- **Leave `cvm deliverable` read-only and give the scheduling agent its own
  deadline store.** Rejected: it duplicates the one date-of-intent the schema
  has, and the two copies would drift the first time Matt moved something in
  the app.
- **Expose writes but restrict agents to `--status` only** (dates human-only).
  Rejected: slipping a date _is_ the most common outcome of a stand-up, and a
  read-only date would push the agent straight back to a second store.
- **Treat this as a plain implementation detail and write no ADR.** Tempting —
  no decision in ADR-0007 is being reversed. Rejected because a future reader
  who finds an agent writing the "manual" calendar would reasonably think 0007
  had been violated; the cheap fix is to say once, here, that it hasn't.

## Consequences

- ADR-0007 should be read as "underived", not "hand-typed". ADR-0009 is
  unaffected.
- The Deliverables Calendar becomes a shared surface between Matt and an agent.
  Conflicting edits are last-write-wins, as they already are between browser
  tabs; nothing detects that an agent moved a date Matt had just set.
- If a future agent needs to _propose_ rather than _set_ a date, that is a new
  decision (a proposal state on the Deliverable) and not covered here.
