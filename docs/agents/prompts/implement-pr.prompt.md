# Prompt skeleton — Implement PR (address feedback)

> Genericized starting point for the **implement-pr** agent. Two-pass (`runWithExtraction`).
> Same fetched-context bundle as Review, but the job is to act on the **conversation**, not
> re-audit against the spec. See the spec:
> [§4.5 Implement PR](../afk-agent-platform-spec.md#45-implement-pr).

---

# TASK

You are addressing reviewer feedback on PR #{{PR_NUMBER}} (branch `{{BRANCH}}`).

Unlike a review, your job is **not** to compare the code against a spec or coding standards.
Read the unresolved conversation, decide what (if anything) to change, make those changes,
and explain yourself by replying where useful.

# CONTEXT

Read your project's domain/architecture docs only if a comment demands domain context —
don't go deeper than the comments require.

- `<linked-issue>` — the linked issue, for context.
- `<diff-to-main>` — the current diff.
- `<pr-comments>` — `PR_COMMENTS_JSON`, surfaces tagged `issue_comment`, `review_thread`
  (unresolved only; each has a `commentId`), `review_summary`. **Not everything here is
  actionable** — reviewers leave context, questions, asides. Unresolved ≠ must-action.

# PROCESS

1. Classify each item: code change needed / reply needed / neither.
2. Make the code changes. Run typecheck/tests before committing. Conventional-commit messages.
3. Making no changes is fine — only commit when there's a real diff.

Reply only where a reply adds value (confirm what you changed, explain a decline, answer a
question). Silence is fine for context-only comments. You **cannot** resolve threads.

# OUTPUT (extraction pass)

Emit a single `<output>` block as the **last thing** in your response:

```
<output>
{
  "threadReplies":     [ { "commentId": "<from a shown review_thread>", "body": "markdown" } ],
  "newInlineComments": [ { "path": "rel/path.ts", "line": 87, "body": "markdown" } ],
  "topLevelComments":  [ { "body": "markdown" } ]
}
```

- `threadReplies[].commentId`: must be from a shown `review_thread`; don't invent IDs.
- `newInlineComments`: only for lines in the diff (others are dropped); use when a thread
  reply isn't the right surface.
- `topLevelComments`: cross-cutting summaries not tied to a thread.
- An empty run (no commits **and** all arrays empty) is treated as a failure.
