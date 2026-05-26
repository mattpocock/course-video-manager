# Prompt skeleton — Write PR (single issue)

> Genericized starting point for the **write-pr** agent. Single-pass (`runWithRetry`):
> the output IS the work; no implementation, no tests. See the spec:
> [§4.2 Implement](../afk-agent-platform-spec.md#42-implement-single-issue).

---

# TASK

Write the title and description for a pull request that closes issue #{{ISSUE_NUMBER}}:
{{ISSUE_TITLE}}.

The implementation is already done — commits sit on branch `{{BRANCH}}`. You are **not**
implementing anything and **not** running tests. You are summarising work that already
exists.

# CONTEXT

Read the issue, then read what changed on the branch _(project-specific commands, e.g.):_

```
git log <base>..{{BRANCH}} --reverse
git diff <base>..{{BRANCH}} --stat
git diff <base>..{{BRANCH}}
```

If the diff is large, lean on commit messages and `--stat`; only `git diff` specific files
when a message is unclear.

# OUTPUT

Emit a single `<output>` block as the **last thing** in your response:

```
<output>
{
  "prTitle": "feat: short imperative summary",
  "prDescription": "## Summary\n\n- bullet 1\n- bullet 2\n\nCloses #{{ISSUE_NUMBER}}"
}
</output>
```

- `prTitle`: single line, < 70 chars, conventional-commit style.
- `prDescription`: must include `Closes #{{ISSUE_NUMBER}}` so the PR closes the issue on merge.
