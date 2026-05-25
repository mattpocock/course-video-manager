# EMIT STRUCTURED OUTPUT

You have finished the review. **Do not make any further code changes** — only report what you already did.

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

| Field                   | Type    | Required | Notes                                                                                                                                                                                                                                              |
| ----------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary`               | string  | **yes**  | 1–3 short markdown paragraphs. Even on a clean review, explain why no changes were needed.                                                                                                                                                         |
| `inlineComments`        | array   | no       | Omit or `[]` if none.                                                                                                                                                                                                                              |
| `inlineComments[].path` | string  | **yes**  | Relative file path, e.g. `"app/foo/bar.ts"`.                                                                                                                                                                                                       |
| `inlineComments[].line` | integer | **yes**  | A **single line number** (e.g. `42`), not a range. Must be a number, not a string. Points to the current HEAD (the diff you reviewed is unchanged). The workflow validates path+line exist in the diff; hallucinated anchors are silently dropped. |
| `inlineComments[].body` | string  | **yes**  | Markdown comment body.                                                                                                                                                                                                                             |
| `replies`               | array   | no       | Omit or `[]` if none.                                                                                                                                                                                                                              |
| `replies[].commentId`   | string  | **yes**  | Must be a `commentId` from a `review_thread` you were shown. Do not invent IDs.                                                                                                                                                                    |
| `replies[].body`        | string  | **yes**  | Markdown reply posted in-thread.                                                                                                                                                                                                                   |

Do **not** add fields that aren't listed above (no `verdict`, no `file`, no `lineRange`, no `comment`). The JSON is machine-parsed; extra or renamed fields cause a validation failure.
