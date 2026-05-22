# TASK

You are breaking a PRD into a flat list of native GitHub sub-issues. You do
**not** create the issues yourself. You emit a structured plan; the wrapping
script creates and attaches the sub-issues deterministically.

- **PRD:** #{{PRD_NUMBER}} — {{PRD_TITLE}}

# CONTEXT

1. Fetch the PRD:

   ```
   gh issue view {{PRD_NUMBER}} --comments
   ```

   Read it carefully. The PRD is the spec — do not add scope, do not
   redesign. If the PRD is ambiguous, make the most reasonable
   interpretation and proceed; do not stop to ask.

2. Read `CONTEXT.md` and skim `docs/adr/` for any decisions that bear on
   the area the PRD touches. Sub-issue titles and bodies must use the
   project's vocabulary.

3. Optionally explore the codebase to ground the breakdown in the real
   shape of the files you'll be cutting through.

# DRAFTING SUB-ISSUES

Break the PRD into **tracer-bullet** vertical slices. Each slice is a thin
vertical cut through every layer (schema → API → UI → tests), NOT a
horizontal slice of one layer.

Rules:

- Each slice delivers a narrow but COMPLETE path through every layer.
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.
- Sub-issues are **flat** — a sub-issue must not itself need sub-issues.
  If a slice is too big to leaf, split it into multiple peer slices.
- Sub-issues run in **list order** under the PRD. Order them so
  dependencies are satisfied: if slice B builds on slice A's schema, A
  must come first.
- Each slice must stand on its own in a single agent session. A reasonable
  session can build a couple of files, write tests, and run
  typecheck/test. Don't draft slices that are unrealistic for one session.

# OUTPUT

Emit a single `<output>` block as the last thing in your response. The
script parses it with a strict schema.

<output>
{
  "slices": [
    {
      "title": "short imperative title",
      "whatToBuild": "One to three short paragraphs describing this slice's end-to-end behavior, framed around what it delivers. No file paths. Plain text — embed newlines literally as \\n in the JSON.",
      "acceptanceCriteria": [
        "Concrete, checkable outcome 1",
        "Concrete, checkable outcome 2",
        "Tests cover the new behavior"
      ]
    }
  ]
}
</output>

Field rules:

- `slices` — ordered array. List order is execution order; the script
  attaches them in this order under the PRD. A later slice may build on
  any earlier slice's work; the ordering is the only signal of phase.
- `title` — short, imperative. No leading `feat:` / `fix:` prefix.
- `whatToBuild` — prose, not a list. Avoid specific file paths or code
  snippets. Exception: a prototype-derived snippet (state machine,
  reducer, schema, type shape) may be inlined when prose can't encode the
  decision as precisely.
- `acceptanceCriteria` — array of strings. The script renders them as a
  GitHub checklist (`- [ ] ...`). Always include one item that asserts
  tests cover the new behavior.

Do NOT include a `Closes` directive anywhere in the body — the script
omits one by design. Closing sub-issues is the implement-prd workflow's
job; closing the PRD is the merged PR's job.
