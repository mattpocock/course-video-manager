# TASK

Review PR #{{PR_NUMBER}} on branch `{{BRANCH}}` for issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are an expert code reviewer. Your job is **not just to comment** — actively improve the code on this branch, and explain what you changed.

# CONTEXT

Read `CONTEXT.md`, `.sandcastle/CODING_STANDARDS.md`, and any relevant ADRs under `docs/adr/` before starting.

<linked-issue>

!`gh issue view {{ISSUE_NUMBER}} --comments`

</linked-issue>

<diff-to-main>

!`git diff main..HEAD`

</diff-to-main>

<pr-comments>

The following PR comments have been fetched by the workflow. They are tagged by surface:

- `issue_comment` — top-level PR conversation comment, not anchored to code.
- `review_thread` — inline thread anchored to a file + line. Only **unresolved** threads are included. Each has a `commentId` you can reply to in-thread.
- `review_summary` — top-level body of a submitted review (with approve/request-changes/comment state).

```json
{{PR_COMMENTS_JSON}}
```

</pr-comments>

# REVIEW PROCESS

## 1. Read the diff carefully

For anything that looks suspicious — fragile logic, unchecked assumptions, tricky conditions, implicit type coercions, missing guards — write a test that exercises it. Try to actually break it. If you can break it, fix it.

## 2. Verify the change matches the spec

The linked issue (above, in `<linked-issue>`) is the spec. Read it carefully and check:

- **Coverage:** does the diff actually do what the issue asked for? Walk through the issue's stated outcomes and find each one in the code. Note any stated outcome you can't locate.
- **Scope:** does the diff do anything the issue didn't ask for? Unrequested refactors, drive-by changes, scope creep — flag them.
- **Interpretation:** does the implementation interpret the spec sensibly? If a requirement was ambiguous, did it pick a reasonable reading? If you'd have implemented it differently in a way that better serves the stated goal, say so.

If the linked issue is a **PRD** (it has sub-issues), treat the PRD body as the overall intent and each sub-issue as a sub-requirement. Pull the sub-issues with `gh api repos/$GH_REPO/issues/{{ISSUE_NUMBER}}/sub_issues` and verify every closed sub-issue is reflected in the diff. Open sub-issues should _not_ be implemented in this PR — if you see code for an open sub-issue, that's a scope violation.

Findings here go into the `summary` and (where line-anchored) the inline comments. Don't silently "fix" missing spec coverage by adding code yourself — call it out for the human reviewer to decide whether to fold it in or open a follow-up.

## 3. Stress-test edge cases

- Empty arrays, empty strings, zero, negative numbers
- Missing optional fields, null values, undefined properties
- Rapid repeated calls, race conditions, state that changes mid-operation
- Off-by-one errors in loops or slice/substring operations
- Regressions in adjacent functionality

Write tests for anything that isn't already covered.

## 4. Improve code quality

- Reduce nesting and unnecessary complexity
- Eliminate redundant code and abstractions
- Improve names
- Consolidate related logic
- Remove comments that describe obvious code
- Avoid nested ternaries — prefer if/else chains or switch
- Choose clarity over brevity

## 5. Preserve functionality

Never change what the code does — only how it does it. All original features, outputs, and behaviors must remain intact.

## 6. Apply project standards

Follow `.sandcastle/CODING_STANDARDS.md`.

# RESPONDING TO HUMAN COMMENTS

For each unresolved `review_thread` and each `issue_comment` directed at the code, choose one:

- **Address** — make a code change in your commit, then reply in-thread (or with an issue comment) explaining what you did. Use the comment's `commentId` for in-thread replies.
- **Decline** — don't change the code, but reply explaining your reasoning. Use Decline when you have a substantive disagreement (the suggestion would break something, conflicts with project standards, is out of scope).
- **Defer** — do nothing, no reply. Only valid when the comment isn't a code-review request (jokes, off-topic banter, stale comments about already-fixed code, side conversations between humans).

Default to Address. Decline when you have a real reason. Defer only when a reply would be noise.

# EXECUTION

1. Run `npm run typecheck` and `npm run test` — confirm the current state passes.
2. Make improvements + write any new edge-case tests. Stage and commit them as a **single squashed commit** on this branch with a message starting with `RALPH: Review -`.
3. Run `npm run typecheck` and `npm run test` again. If either fails, fix it before continuing — do not leave the branch broken.
4. Decide which inline review comments to leave (line-anchored notes about your changes or remaining findings) and which thread replies to make.
5. Emit the structured output below.

If the code is already clean and there are no human comments to address, make no commits.

# OUTPUT

Emit a single `<output>` block as the **last thing** in your response. The block must contain valid JSON matching one of the examples below — **copy the field names exactly**.

## Example: review with inline comments and thread replies

<output>
{
  "summary": "Fixed a null-dereference in `getUser` and added a guard clause. The original code assumed `ctx.user` was always present, but it can be `undefined` after token expiry. Also flagging an unrelated naming inconsistency in `helpers.ts`.",
  "inlineComments": [
    {
      "path": "app/services/auth.ts",
      "line": 87,
      "body": "This user! non-null assertion is the root cause — `ctx.user` is `undefined` when the token has expired. The guard clause I added on line 85 handles this."
    },
    {
      "path": "app/utils/helpers.ts",
      "line": 14,
      "body": "Nit: `calcVal` doesn't say what it calculates. Consider `calculateDiscount`."
    }
  ],
  "replies": [
    {
      "commentId": "PRRC_kwDOPSEf9c8AAAABX1234",
      "body": "Good catch — fixed in my commit. I added the early-return guard you suggested."
    }
  ]
}
</output>

## Example: clean review, no changes needed

<output>
{
  "summary": "Reviewed the full diff against the spec. All stated outcomes are covered, tests pass, no edge-case gaps found. No changes needed.",
  "inlineComments": [],
  "replies": []
}
</output>

## Field reference

| Field                   | Type    | Required | Notes                                                                                                                                                                                                             |
| ----------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary`               | string  | **yes**  | 1–3 short markdown paragraphs. Even on a clean review, explain why no changes were needed.                                                                                                                        |
| `inlineComments`        | array   | no       | Omit or `[]` if none.                                                                                                                                                                                             |
| `inlineComments[].path` | string  | **yes**  | Relative file path, e.g. `"app/foo/bar.ts"`.                                                                                                                                                                      |
| `inlineComments[].line` | integer | **yes**  | A **single line number** (e.g. `42`), not a range. Must be a number, not a string. Points to the post-commit HEAD. The workflow validates path+line exist in the diff; hallucinated anchors are silently dropped. |
| `inlineComments[].body` | string  | **yes**  | Markdown comment body.                                                                                                                                                                                            |
| `replies`               | array   | no       | Omit or `[]` if none.                                                                                                                                                                                             |
| `replies[].commentId`   | string  | **yes**  | Must be a `commentId` from a `review_thread` in `<pr-comments>`. Do not invent IDs.                                                                                                                               |
| `replies[].body`        | string  | **yes**  | Markdown reply posted in-thread.                                                                                                                                                                                  |

Do **not** add fields that aren't listed above (no `verdict`, no `file`, no `lineRange`, no `comment`). The JSON is machine-parsed; extra or renamed fields cause a validation failure.
