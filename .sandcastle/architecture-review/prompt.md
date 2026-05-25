# TASK

You are running the daily architecture-review pass. Find one fresh deepening
opportunity in this codebase and publish it as a PRD.

This is an unattended CI run. There is no user to grill, no HTML report to
write. Your job is:

1. List prior proposals labelled `source:architecture-review` (open and
   closed) so you don't re-propose them.
2. Explore the codebase.
3. Pick **one** top candidate.
4. Publish it via `/to-prd-project`.
5. Apply the `source:architecture-review` label to the new issue.

The full process — including the methodology (deletion test, deepening,
glossary), the loose-duplicate rule, the PRD shape, and the exact `<output>`
schema — is documented in the project skill
`improve-codebase-architecture-project`. Follow it.

# CONTEXT

Read `CONTEXT.md` and any relevant ADRs under `docs/adr/` before proposing
anything. Treat ADRs as binding — do not propose changes that contradict a
recorded decision.

# RULES

- Read-only on the repo. No commits. No edits to `CONTEXT.md`, ADRs, or
  source files. The only mutations allowed are creating the PRD issue (via
  `/to-prd-project`) and applying the `source:architecture-review` label.
- One PRD per run. If every reasonable candidate is already covered by a
  prior `source:architecture-review` proposal, emit a `skipped` output and
  stop.
- No questions to a user — there is none. Make the call.
