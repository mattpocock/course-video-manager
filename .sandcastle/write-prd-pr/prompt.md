# TASK

Write the title and description for a pull request that delivers PRD #{{PRD_NUMBER}}: {{PRD_TITLE}}.

The PRD ships as a chain of sub-issue runs, all committing to the same
branch. This PR will be reused across every sub-issue run, so the
title and description must describe the **whole PRD**, not any
individual sub-issue. You are NOT implementing anything.

# CONTEXT

Read the PRD and its sub-issues:

```
gh issue view {{PRD_NUMBER}} --comments
gh api repos/$GH_REPO/issues/{{PRD_NUMBER}}/sub_issues
```

# OUTPUT

Emit a single block as the last thing in your response:

<output>
{
  "prTitle": "feat: short imperative summary of the PRD as a whole",
  "prDescription": "## Summary\n\nWhat the PRD delivers, in 1–3 paragraphs framed around the whole effort.\n\n## Sub-issues\n\n- #N — title\n- #M — title\n\nCloses #{{PRD_NUMBER}}"
}
</output>

Rules:

- `prTitle` must be a single line, under 70 characters, conventional-commit style (`feat:`, `fix:`, `refactor:`, etc.), framed around the PRD as a whole.
- `prDescription` must:
  - describe the PRD's overall intent (restate the goal from the PRD body),
  - list every sub-issue with its number and title,
  - end with `Closes #{{PRD_NUMBER}}` so the PR auto-closes the PRD on merge.
