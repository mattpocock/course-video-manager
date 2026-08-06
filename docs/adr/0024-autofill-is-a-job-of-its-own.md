---
status: accepted
---

# The Autofill is a job of its own, not a stage of the Publish

Two fields stand between a finished **Course** and a **Publish**, and neither is real work. Every shipping **Video** needs a `description` and needs **Chapters**. Both were already AI-generated one Video at a time, and the actual process was to press Generate and accept whatever came back, unread — nothing reviewed, nothing edited. Yet the app treated both as authoring tasks: a **Missing Chapters** warning per Video in the course view, both listed as publish blockers, and the **Publish** button disabled until every one had been clicked through by hand. For a thirty-Video course that is sixty clicks of pure ceremony.

We introduce the **Autofill**: a review-free pass that writes every shipping Video's missing `description` and missing **Chapters** in one go, driven from the publish page by a single button with two labels.

## Why it is not a stage inside the Publish

The obvious design is to fold this into `publishUnlocked` as a stage before validation. It cannot work, for a reason easy to miss: **Missing Chapters is a blocking lint**, so the Publish button is disabled in exactly the situation the Autofill exists to fix. A stage inside a Publish nobody can start is unreachable. That constraint is also the reason the button has two labels rather than the Publish quietly doing the work first — the author has to be able to press something.

The second reason is blast radius. A Publish is long and expensive, holds a global mutation semaphore, and has a **Pending Version** to unwind on failure. A rate limit from Anthropic must not be able to touch any of that. Keeping the Autofill separate means its failures reach nothing: a failed Autofill leaves the Publish untouched and independently startable, and there is no Pending Version to reconcile.

So the Autofill is orchestrated from the client: start a run, wait for it to settle, re-read **Publish Readiness**, stop. It never rolls on into a Publish. `publishUnlocked` is not modified, no `PublishStage` literal is added, and **Submit** / **Promote** / **Discard** are untouched.

## Why the warnings move but their meaning does not

Because the Autofill now owns those two fields, they stop being the author's problem — so the **Missing Chapters** warning and the missing-`description` signal are removed from the course view, the **Section Workbench** and the video editor. They stay exactly as blocking inside **Publish Readiness**: a Video whose Autofill failed still cannot ship. Only where they are shown changes. On the publish page the Autofill-clearable blockers are grouped under an accordion, so eight blockers do not read as eight problems when six of them are one button press.

This is the deliberate cost of the design: the course-view warning badge now reads lower than the publish page's blocker count. That is the point — the tree shows work only the author can do.

## Why the models are pinned

The real cost of this feature is that a human review step is removed on purpose. In practice nothing changes today, because that output was already accepted unread; what changes is that there is no longer a moment where a bad generation _could_ be caught. Both models are therefore pinned in `TextGeneration` — Haiku 4.5 for the `description`, Sonnet 4.5 for the **Chapters**. Changing a model and changing the workflow at the same time would hide which one caused a regression. Evals over both generators are the real mitigation and are a follow-up, not this build.

## Considered alternatives

- **A stage inside `publishUnlocked`.** Rejected: unreachable behind its own blocking lint, and it would let a model rate limit fail a Publish and strand a Pending Version.
- **Relaxing `canPublish` so a missing description or chapters no longer blocks.** Rejected: the readiness gate keeps giving one honest answer. A Video whose Autofill failed must not ship without chapters.
- **A separate, always-visible Autofill button beside Publish.** Rejected: two controls where one action is available at a time. The label always describes what the button would do — including the disabled "Publish" when the Autofill can do no more but blockers remain.
- **A durable background worker.** Deferred, not rejected. The run's state lives in client memory like every other upload type, so it stops if the tab closes. "Away from keyboard" here means no decisions, not no browser. A real job queue is the intended next step.
- **A `cvm course autofill` verb.** Deferred: the Autofill is UI-only for now, which keeps this build small.

## Consequences

- **Two surfaces now disagree on purpose.** The course view's warning count is a strict subset of the publish page's blocker count. Anyone reconciling the two must know why; `authoringVideoWarnings` is where the subset is taken.
- **A quality regression can ship silently.** No eval covers either generator, and nothing reviews the output. Pinned models are the interim mitigation.
- **The candidate rule has exactly one home.** `selectAutofillCandidates` backs both the button's count and the run's behaviour. Re-deriving "which Videos need work" anywhere else would let the button promise work the run then does not do.
- **A run stops with the tab.** Accepted for now; see the deferred worker above.
