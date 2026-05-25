# EMIT STRUCTURED OUTPUT

You have finished addressing the feedback. **Do not make any further code changes** — only report the replies and any new inline comments you want posted, based on what you already did.

Emit a single `<output>` block as the **last thing** in your response. Valid JSON, field names exact.

## Example

<output>
{
  "threadReplies": [
    {
      "commentId": "PRRC_kwDOPSEf9c8AAAABX1234",
      "body": "Good catch — fixed in the latest commit by adding the early-return guard."
    },
    {
      "commentId": "PRRC_kwDOPSEf9c8AAAABX5678",
      "body": "I'd push back on this one — renaming `calcVal` to `calculateDiscount` would conflict with the `calcVal` convention used elsewhere in this file. Happy to do it as a follow-up across the whole file if you want."
    }
  ],
  "newInlineComments": [
    {
      "path": "app/services/auth.ts",
      "line": 87,
      "body": "Heads up — while addressing the thread above I also tightened the guard on line 85. Flagging in case it affects the test you mentioned."
    }
  ],
  "topLevelComments": [
    {
      "body": "Addressed 2 of 3 threads. Left the third (about the helper rename) for a separate PR — explained inline."
    }
  ]
}
</output>

## Empty output (rare)

If you made no code changes and have nothing to say, emit:

<output>
{ "threadReplies": [], "newInlineComments": [], "topLevelComments": [] }
</output>

The workflow will mark the run as blocked if both the diff and all reply arrays are empty — that's a degenerate run.

## Field reference

| Field                       | Type    | Required | Notes                                                                                                               |
| --------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `threadReplies`             | array   | no       | Replies posted in an existing unresolved review thread.                                                             |
| `threadReplies[].commentId` | string  | **yes**  | Must be a `commentId` from a `review_thread` you were shown. Do not invent IDs.                                     |
| `threadReplies[].body`      | string  | **yes**  | Markdown reply.                                                                                                     |
| `newInlineComments`         | array   | no       | New inline comments on lines in the diff (not replies). Use only when a thread reply isn't the right surface.       |
| `newInlineComments[].path`  | string  | **yes**  | Relative file path.                                                                                                 |
| `newInlineComments[].line`  | integer | **yes**  | Single line number in the current HEAD (the diff is unchanged). The workflow drops anchors that aren't in the diff. |
| `newInlineComments[].body`  | string  | **yes**  | Markdown.                                                                                                           |
| `topLevelComments`          | array   | no       | New top-level PR conversation comments. Use for cross-cutting summaries or comments not tied to a thread.           |
| `topLevelComments[].body`   | string  | **yes**  | Markdown.                                                                                                           |

Do not add fields not listed above.
