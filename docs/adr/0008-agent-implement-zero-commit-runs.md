# Zero-commit agent runs are allowed

The PRD implementation workflow (`.github/workflows/agent-implement-prd.yml` + `.sandcastle/implement-prd/implement-prd.ts`) does **not** fail when the agent produces zero new commits for a sub-issue. A run with no new commits is treated as success: the sub-issue is closed, the workflow advances to the next sub-issue, and — if no PR exists yet for the branch — `gh pr create` is the only thing that can still fail naturally on a fully empty branch.

The single-issue workflow (`.sandcastle/implement/implement.ts`) follows the same rule by omission: it has no commit check, and relies on `gh pr create` to refuse an empty branch.

## Why

A PRD's sub-issues are not independent — earlier sub-issues frequently subsume later ones. By the time the agent reaches sub-issue 4, the rename / refactor / cascade work it describes may already have landed in the commit that closed sub-issue 2. The agent then correctly determines there is nothing to do and produces zero commits. That is a successful outcome, not a failure.

The previous heuristic — "fail the run if `result.commits.length === 0`" — punished exactly this case, marking the PRD `agent:blocked` and halting the chain even though all acceptance criteria were already met on the branch. See the failure on PRD #853 / sub-issue #854 (run 26230340854) for a concrete instance.

## Rejected alternatives

- **Check "branch is ahead of `main`" instead of "this run produced commits".** Closer to the right invariant, but still wrong: it would fail a legitimate first-sub-issue scenario where the prior work somehow already merged to `main`, and it adds friction for the same reason — the agent's correct answer of "nothing to do" gets rejected by a script-level guard.
- **Reorder the workflow so PR creation precedes sub-issue close**, then drop all guards. Would make `gh pr create`'s natural failure cover the "branch empty on first sub-issue" case without leaving the sub-issue wrongly closed. Not adopted yet — current ordering is fine once the no-commit case is accepted as success, and the reordering is an additive future change.

## Consequences

- A sub-issue may close with zero commits attributable to its own run. The PRD's eventual PR description is the system of record for what was actually delivered; per-sub-issue commit attribution is not.
- If the agent silently does nothing (genuine bug, not "work already done"), the workflow still chains forward. The PR review step at the end of the PRD is the catch-all for "did this PRD actually deliver its acceptance criteria" — not the per-sub-issue commit count.
- `update-branch.ts`'s pre/post-SHA check is **not** governed by this ADR. That check answers a different question ("did the agent resolve the merge conflicts it was invoked for?") and remains in place.
