# Prompt skeleton — Implement PRD (one sub-issue)

> Genericized starting point for the **implement-prd** agent. No structured output. Unlike
> single-issue implement, **zero new commits is acceptable** (the sub-issue may already be
> satisfied). See the spec: [§4.3 Implement PRD](../afk-agent-platform-spec.md#43-implement-prd).

---

# TASK

You are implementing one sub-issue of a multi-session PRD.

- **PRD:** #{{PRD_NUMBER}} — {{PRD_TITLE}}
- **This sub-issue:** #{{SUB_ISSUE_NUMBER}} — {{SUB_ISSUE_TITLE}}
- **Branch:** `{{BRANCH}}`

The branch may already have commits from earlier sub-issues. Do **not** rebase or rewrite
that history — add your work on top.

Pull both issues for context _(project-specific commands)_: the full PRD (read carefully —
your work must fit the larger plan) and the specific sub-issue. You also have the full list
of sibling sub-issues — use it to understand what has shipped and what is ahead, but
**only implement #{{SUB_ISSUE_NUMBER}}** in this session.

# CONTEXT

Read your project's domain/architecture docs before starting. Explore the parts of the repo
relevant to this sub-issue — especially nearby test files.

# EXECUTION

Use red-green-refactor where applicable (RED → GREEN → REPEAT → REFACTOR). Run the project's
typecheck and tests before committing.

# COMMIT

Make one or more commits on `{{BRANCH}}` with conventional-commit messages. Include
`Part of #{{PRD_NUMBER}}` in each commit body. Do **not** include `Closes` (the workflow
closes the sub-issue; the merged PR closes the PRD). Do **not** push or close anything — the
workflow handles both.
