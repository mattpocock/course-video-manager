# Prompt skeleton — Implement (single issue)

> Genericized starting point for the **implement** agent. No structured output. The
> orchestrator asserts ≥1 commit afterwards. See the spec:
> [§4.2 Implement](../afk-agent-platform-spec.md#42-implement-single-issue).

---

# TASK

Implement issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are on branch `{{BRANCH}}`, already created from the base branch. Pull in the issue
_(project-specific: e.g. `gh issue view {{ISSUE_NUMBER}} --comments`)_. If it has a parent
PRD, pull that in too.

# CONTEXT

Read your project's domain/architecture docs before starting _(project-specific: e.g.
`CONTEXT.md`, ADRs)_. Explore the repo and fill your context with the parts relevant to this
issue — especially test files that touch the area you'll change.

# EXECUTION

Use red-green-refactor where applicable:

1. RED: write one failing test
2. GREEN: implement to pass it
3. REPEAT until the issue is done
4. REFACTOR

Before committing, run the project's typecheck and tests. _(Project-specific commands.)_

# COMMIT

Make one or more commits on `{{BRANCH}}` with conventional-commit messages
(`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).

- Do **not** push the branch — the workflow handles it.
- Do **not** close the issue — the merged PR handles it.
