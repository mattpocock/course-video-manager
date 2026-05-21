---
name: improve-codebase-architecture-project
description: Survey the codebase, pick ONE high-leverage deepening opportunity (filtering out anything already proposed), and publish it as a PRD-shaped GitHub issue via /to-prd-project. Designed to run unattended in the daily architecture-review workflow.
---

This skill runs unattended in CI. It picks one architectural improvement, publishes it as a PRD, and emits a structured `<output>` block for the driver script. No grilling, no HTML, no human in the loop.

## Methodology

You are looking for **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

### Glossary — use these terms exactly in the PRD

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place.
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

### Key principles

- **Deletion test** — imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

Use `CONTEXT.md` vocabulary for **domain** language. Do not re-litigate decisions recorded under `docs/adr/`.

## Process

### 1. Read prior proposals

```bash
gh issue list --label "source:architecture-review" --state all --limit 200 \
  --json number,title,body,state,labels
```

Read every result. Build a mental list of: which modules each prior PRD touches, what friction it addresses, and whether it was merged, closed-without-merge, or still open. **All of these count as "already proposed"** — the goal is novelty, not re-litigation.

If a prior proposal was closed-without-merge with a comment giving a load-bearing reason, treat that reason as binding: do not re-propose anything matching that reasoning.

### 2. Explore the codebase

Read `CONTEXT.md` and any relevant ADRs under `docs/adr/` first.

Then use the Agent tool with `subagent_type=Explore` to walk the repo. Note friction organically:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow.

### 3. Filter against prior proposals — loose-duplicate rule

A candidate is a duplicate if **either**:

- it touches substantially the same modules as a prior proposal, **or**
- it addresses the same underlying friction, even with a different angle.

When in doubt, treat it as a duplicate. The goal is one _fresh_ proposal per run — duplicates spam the backlog.

### 4. Pick the single top candidate

Internally generate 3-5 candidates, rank them, pick one. Rank on:

- **Leverage** — how much downstream code benefits
- **Locality gain** — how much complexity gets concentrated
- **Test surface improvement** — does the deepened interface make tests cleaner?
- **Cost-to-value** — small refactors that unlock a lot beat sprawling rewrites

If every reasonable candidate is a duplicate, **skip** (see step 6).

### 5. Format the PRD using /to-prd-project — but do NOT publish

Follow the `/to-prd-project` skill to produce the PRD content: same template (Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes) and same writing discipline.

**Critical override:** do not run `gh issue create`. The workflow publishes the issue itself so that creation and labelling are atomic. Your job is to write the title and body; the workflow handles the GitHub mutation.

In addition to the standard PRD-template sections, the body must include an **Architecture review** section at the top with:

- **Files** — which modules are involved
- **Problem** — the friction in current architecture, in `CONTEXT.md` + glossary vocabulary above
- **Solution** — what changes, in plain English
- **Benefits** — framed in terms of **locality** and **leverage**; how tests improve
- **Before / After diagram** — a fenced `mermaid` block showing the shallow → deep transition. GitHub renders Mermaid natively in issue bodies.
- **Recommendation strength** — `Strong`, `Worth exploring`, or `Speculative`

### 6. Emit structured output

The driver script parses a single `<output>` block at the end of your response.

On success (a fresh proposal was found):

```
<output>
{
  "status": "proposed",
  "title": "<the PRD title — short, imperative, < 80 chars>",
  "body": "<the full PRD markdown body, including the Architecture review section and all standard PRD-template sections>",
  "oneLineSummary": "<one sentence describing the proposal, for the workflow run summary>",
  "candidatesConsidered": [
    "<one-line description of candidate 1>",
    "<one-line description of candidate 2>",
    "<one-line description of candidate 3>"
  ]
}
</output>
```

The workflow takes `title` + `body` and runs `gh issue create --label "source:architecture-review"`. Do not call `gh issue create` yourself.

If every reasonable candidate was already proposed:

```
<output>
{
  "status": "skipped",
  "reason": "<one or two sentences naming the candidates considered and which prior issues blocked them>"
}
</output>
```

## Rules

- **Read-only everywhere.** No commits, no edits to `CONTEXT.md` / ADRs / source files, no `gh issue create`, no `gh issue edit`. The workflow does the publish. If you spot a stale doc, mention it inside the PRD body — don't edit it.
- **One proposal per run.** Never publish more than one PRD in a single invocation.
- **No grilling, no questions.** There is no user. Make the call and emit the `<output>` block.
