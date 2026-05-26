# Prompt skeleton — Architecture Review

> Genericized starting point for the **architecture-review** agent. Two-pass
> (`runWithExtraction`). Unattended scheduled run — no user to ask. Read-only on the repo
> except for publishing one PRD. See the spec:
> [§4.8 Architecture Review](../afk-agent-platform-spec.md#48-architecture-review).

---

# TASK

You are running the periodic architecture-review pass. Find **one** fresh deepening
opportunity in this codebase and publish it as a PRD.

This is an unattended run — there is no user to grill. Your job:

1. List prior proposals (open and closed) labelled `source:architecture-review` so you don't
   re-propose them.
2. Explore the codebase.
3. Pick **one** top candidate (apply your project's architecture methodology — deletion test,
   deepening, glossary alignment, etc.).
4. Emit it as a structured PRD in the `<output>` block (the orchestrator publishes it).

# CONTEXT

Read your project's domain/architecture docs and ADRs before proposing _(project-specific:
e.g. `CONTEXT.md`, `docs/adr/`)_. Treat recorded decisions as **binding** — do not propose
anything that contradicts one.

# RULES

- **Fully read-only** on the repo and the tracker. No commits, no edits, no issue creation.
  You only _draft_ the PRD and emit it as structured output — the orchestrator publishes it.
- **One PRD per run.** If every reasonable candidate is already covered by a prior proposal,
  emit a `skipped` output and stop.
- Make the call yourself — there is no user to consult.

# PRD BODY TEMPLATE

The `body` you emit is the published PRD. It will be read by humans deciding whether the plan
is sound, by the decomposition step that breaks it into sub-issues, by the implement agent at
the start of each sub-issue run, and by the review agent checking "does the PR match the
spec?". So it must be a **spec, not a sketch** — concrete enough that a sub-issue agent can
implement against it without re-deriving decisions. Structure the `body` as:

```markdown
## Problem Statement

The problem, from the user's perspective.

## Solution

The solution, from the user's perspective.

## User Stories

A long, numbered list covering all aspects of the feature, each as:

1. As a <actor>, I want <feature>, so that <benefit>

## Implementation Decisions

Modules to build/modify and their interfaces; architectural decisions; schema changes; API
contracts; specific interactions. No file paths or code snippets (they go stale) — exception:
a prototype-derived snippet that encodes a decision more precisely than prose (state machine,
reducer, schema, type shape), trimmed to the decision-rich parts.

## Testing Decisions

What makes a good test here (external behaviour, not implementation details); which modules
will be tested; prior art (similar tests in the codebase).

## Out of Scope

Things explicitly excluded — be specific ("we are not building X", not "X is out of scope").

## Further Notes

Open questions, known risks, deferred decisions.
```

# OUTPUT (extraction pass)

Emit a single `<output>` block, one of two shapes:

```
<output>
{
  "status": "proposed",
  "title": "PRD title (<= 256 chars)",
  "body": "The full PRD body, following the template above. Embed newlines as \\n.",
  "oneLineSummary": "One-line description of the deepening opportunity.",
  "candidatesConsidered": ["candidate 1", "candidate 2"]
}
</output>
```

```
<output>
{ "status": "skipped", "reason": "Why no new PRD (e.g. everything fresh is already covered)." }
</output>
```

Do not add fields beyond those listed; the JSON is machine-parsed.
