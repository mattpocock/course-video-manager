# Queued Promotion

The `agent:queued` label marks an issue as "ready for agent work, but waiting on its blockers." When the last blocker closes, `.github/workflows/agent-promote-queued.yml` flips the label to `agent:implement`, which triggers the normal `agent-implement.yml` flow.

## Trigger

The workflow listens for `issues: closed` events — regardless of whether the close came from a merged PR (via `Closes #N`), a manual close, or `gh issue close`. Closes with `state_reason == 'not_planned'` (wontfix) are skipped: a wontfix'd blocker is not a meaningful completion signal.

## Dependency model

Blockers are read from GitHub's native issue dependency relation — the "blocked by" / "blocks" feature, queried via the GraphQL `blocking` and `blockedBy` connections on `Issue`.

The workflow does **not**:

- Parse "Blocked by #N" or "Depends on #N" prose from issue bodies.
- Treat the sub-issue / parent relation as a blocking relation.

## Application

`agent:queued` is **applied manually by a human**. There is no guard workflow on `agent:implement` that downgrades blocked issues to `agent:queued` — if you slap `agent:implement` on an issue whose dependencies aren't done, the agent run will happen and likely fail or produce a broken PR. Apply `agent:queued` yourself when you know an issue is waiting.

## Behavior per dependent

When a blocker `X` closes, the workflow walks `X.blocking` (the dependents) and for each open issue `Y`:

| Y's state                                        | Action                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing `agent:queued`                           | Silent skip.                                                                                                                                         |
| Has `agent:in-progress`                          | Silent skip — a run is already going.                                                                                                                |
| Is a sub-issue of another issue                  | Refuse: remove `agent:queued`, add `agent:blocked`, comment explaining `agent:queued` is not meaningful on sub-issues; label the parent PRD instead. |
| Still has other open blockers                    | Silent skip — wait for the last one to close. No comment (the GitHub UI already shows remaining blockers).                                           |
| No remaining open blockers, still `agent:queued` | Remove `agent:queued`, comment "Unblocked by #N closing — promoting…", add `agent:implement`.                                                        |

## Race handling

Two blockers closing within seconds will fire two parallel workflow runs. There is no concurrency group — instead, the flip step re-fetches `Y`'s labels immediately before mutating, and silently exits if `agent:queued` has already been removed. The downstream `agent-implement.yml` has its own preflight (refuses if an open PR exists for `Y`), so duplicate triggers land safely.

## `AGENT_PAT` and downstream triggering

Labels added via `GITHUB_TOKEN` do not fire downstream workflows. The promotion step uses `AGENT_PAT` when present, falling back to `GITHUB_TOKEN`. In the fallback path, the `agent:implement` label lands but `agent-implement.yml` will not auto-trigger — a human will need to re-add the label.
