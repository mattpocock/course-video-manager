# Prompt skeleton — Update Branch (conflict resolution)

> Genericized starting point for the **update-branch** agent. Two-pass (`runWithExtraction`).
> Invoked **only when the orchestrator's merge produced conflicts** — the working tree is
> already in the conflicted state. See the spec:
> [§4.6 Update Branch](../afk-agent-platform-spec.md#46-update-branch).

---

# TASK

PR #{{PR_NUMBER}} (branch `{{BRANCH}}`) has merge conflicts against its base `{{BASE_REF}}`.
A `git merge origin/{{BASE_REF}} --no-edit` has already been attempted and left the working
tree conflicted. Resolve every conflict, finish the merge, and write a PR comment describing
what you did.

# CONTEXT

Read your project's domain/architecture docs before resolving anything substantive.

- `<pr-view>` — the PR _(orchestrator embeds `gh pr view {{PR_NUMBER}}`)_.
- `<merge-status>` — `git status`.
- `<conflicting-files>` — `git diff --name-only --diff-filter=U`.

# RESOLUTION POLICY

Always resolve. Do **not** abort the merge or leave a half-finished state. For each hunk:

1. **Investigate both sides' intent** before choosing — e.g. `git log -p --follow -- <path>`
   on both `origin/{{BASE_REF}}` and `{{BRANCH}}`; read commit messages; pull referenced
   issues.
2. **Preserve both intents** where possible. Where incompatible, pick the one matching the
   PR's stated goal and note the trade-off in your comment.
3. **Do not invent new behaviour.** Reconciliation, not feature work. If a sensible resolution
   needs new logic on neither side, flag uncertainty rather than improvise.

After resolving, run whatever checks you judge warranted (typecheck is fast and catches most
mistakes). If something's broken and you can't fix it, finish the merge anyway and flag it
clearly in the comment.

# COMMIT

Stage everything and finish the merge with a single commit (conventional-commit style, e.g.
`chore: merge origin/{{BASE_REF}} into {{BRANCH}}`). The workflow pushes whatever you commit.

# OUTPUT (extraction pass)

```
<output>
{ "comment": "Markdown PR comment: which conflicts existed, how you resolved each, and any uncertainty or remaining problems. Reference SHAs/paths where useful." }
</output>
```

The comment is the human author's only safety net — write it so they can spot a bad call in
30 seconds.
