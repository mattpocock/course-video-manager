# Derive Pitch Desk State from linked Deliverables

The manual five-value `status` field on Pitch (`idle`, `scheduled`, `shipped-to-youtube`, `shipped`, `cancelled`) drifted out of sync with reality because the author had to remember to update it separately from the Deliverables Calendar. We replaced it with a derived **Pitch Desk State** — computed live from linked Deliverable statuses, never stored.

## Decision

Drop the `status` column from the `pitches` table. Derive desk state in the pitch operations service using the rule: no linked Deliverable = `idle`; any non-terminal linked Deliverable = `scheduled`; all linked Deliverables terminal (`done` or `cancelled`) = `shipped`. The derivation runs load-then-derive-in-app (not a SQL aggregate) because the dataset is personal-scale and keeping the rule in one place is more valuable than query-level filtering.

Abandoning a pitch stays a deliberate act via **Archive**, independent of desk state.

## Amends

This amends **ADR-0007** (Deliverables Calendar is manual and informational): a Deliverable's own state is still never derived, but a linked Pitch's desk state is now derived from it. The "no automatic state propagation" guarantee now flows in one direction only — Deliverable status drives Pitch desk state, but Pitch desk state never drives Deliverable status.

## Consequences

- Pitches previously marked `shipped` or `cancelled` without a linked Deliverable resurface as `idle`. Accepted as a one-time cost; the author archives them by hand.
- The `shipped-to-youtube` state is removed. Per-channel progress is expressed by having separate Deliverables; a YouTube-done-but-newsletter-pending pitch is correctly `scheduled`.
- The pitches index defaults to `idle + scheduled` (hidden: `shipped`), with a single "Show shipped" toggle. The `/pitches` bookmark survives because the default omits the URL param.
- Deliverable form and card pitch pickers group by the three derived states instead of five manual statuses.
