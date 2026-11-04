# Landing a change

`main` is protected by a ruleset: a PR merges only once the `check` status is green on a branch that is up to date with `main` (strict). Every change lands through this sequence.

1. **Worktree.** `git fetch origin && git worktree add .claude/worktrees/<name> -b <branch> origin/main`, then `pnpm install --frozen-lockfile --prefer-offline` inside it. A worktree never opens a writable connection to a remote database: `DrizzleService`, the `db:*` scripts and drizzle-kit refuse (`packages/core/db/connection-guard.ts`), and `cvm`'s local-only commands refuse too.
2. **Commit.** `pnpm run check` is green before you push. Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
3. **Browser check.** Any change with a visible effect in the UI is driven in the browser with `verify-cvm` (`.claude/skills/verify-cvm/SKILL.md` — read it directly if the skill isn't loaded) before you open the PR. It runs on a clone of its own and needs no `.env`. Copy the evidence directory out of `.verify/` before the worktree goes.
4. **PR.** `gh pr create`; the body states what you clicked and saw in the browser, with screenshots or the evidence path, or says `No UI change`; the body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
5. **Merge.** Skip this step for a PR that adds or edits a migration (below): Matt merges those. Otherwise, done when the PR shows `MERGED` and your worktree is gone:
   1. Once the PR is ready, queue it: `gh pr merge <pr> --merge --auto`. GitHub merges it when `check` is green on an up-to-date branch, then deletes the head branch itself. Leave off `--delete-branch`: `main` is checked out in another worktree, so the local cleanup fails.
   2. Wait for `check` to pass (`gh pr checks <pr> --watch`).
   3. If `gh pr view <pr> --json mergeStateStatus` says `BEHIND`, run `gh pr update-branch <pr>` and go back to 5.2: auto-merge never updates the branch for you.
   4. Once `gh pr view <pr> --json state` says `MERGED`, `git worktree remove .claude/worktrees/<name>`.

**PRs into other branches.** The ruleset covers `main` only, so a PR into any other branch (an integration branch, say) has no required checks, and `--auto` would merge it at once. Wait for CI to go green (`gh pr checks <pr> --watch`), then merge by hand with `gh pr merge <pr> --merge`.

**Waiting and polling.** Prefer `gh pr checks <pr> --watch` to a hand-rolled loop. Any wait or poll loop you do write gets a timeout (`timeout 900 bash -c 'until …; do sleep 5; done'`) and writes its logs inside your own worktree, never shared `/tmp`: a loop waiting on a file that never appears there runs for hours after you finish. Before you finish, stop every background command you started.

The ruleset is the only gate, and it holds for agents without exception: merge through the loop above, every time. `--admin`, ruleset bypass and direct pushes to `main` are reserved for the human admin.

Never skip hooks: no `git commit --no-verify`, no `HUSKY=0`, no other way round them. If a hook fails because of something on `main`, merge `main` or wait for the PR that fixes it; never bypass the hook.

## A PR with a migration

**Merging a migration PR runs it** (#2655): the `apps/remote` production build backs production up on PlanetScale, waits, then migrates. So **agents never merge a PR that touches `packages/core/db/migrations/`, and never queue `gh pr merge --auto` on one.** Open it, wait for `check`, say in the body that Matt merges it, and stop. Matt merges it. Remove your worktree once the PR is open and green.

Every migration must be safe for the code already serving, and for Matt's local CVM, which also runs against production: additive, and a column is dropped only after no code reads it. Follow the `deploy-migration` skill (`.claude/skills/deploy-migration/SKILL.md`). Never run `db:migrate` against production (ADR 0026); `pnpm db:migrate:prod` is Matt's break-glass path.
