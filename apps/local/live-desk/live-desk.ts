import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";

/**
 * Matt's live desk: the Stream Deck forwarder hub his button presses go
 * through. Only the MAIN CHECKOUT of the repo may touch it.
 *
 * Every other checkout — an agent's worktree, a verify-cvm run — is pointed at
 * the discard port, where nothing answers. A worktree's editor on the live hub
 * would act on Matt's real presses (delete-last-clip and the rest) and could
 * send to his editor; a worktree's forwarder would take the hub's ports when
 * his stack is down. So the desk FAILS CLOSED: a checkout is live only when it
 * can prove it is the main one, and anything that cannot answer (no git, a
 * tarball, an error) is treated as a worktree.
 *
 * No setup: Matt's main checkout is detected, not declared.
 */

/** Port 9 is discard: nothing listens, so a client fails at once and quietly. */
export const DEAD_DESK_URL = "ws://127.0.0.1:9";

const LIVE_HUB_URL = "ws://localhost:5172";

/** The env key the browser reads its live-desk address from (app/lib/live-channels.ts). */
export const HUB_URL_ENV_KEY = "VITE_STREAM_DECK_HUB_URL";

/**
 * Where agents keep scratch checkouts: the temp directory and Claude's own
 * (`~/.claude/jobs/…`, `.claude/worktrees/…`). A full `git clone` there has a
 * git dir that IS its common dir, exactly like Matt's main checkout, so the
 * git test alone let an agent's verify-cvm clone onto his recorder service
 * (#2291). Matt's main checkout never lives in one.
 */
export const AGENT_SCRATCH_ROOTS: readonly string[] = [
  tmpdir(),
  "/tmp",
  join(homedir(), ".claude"),
];

const isInside = (dir: string, root: string) => {
  const rel = relative(resolve(root), resolve(dir));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * Whether `cwd` is inside the repo's main checkout: its git dir IS the common
 * git dir (in a linked worktree the git dir is `.git/worktrees/<name>`, which
 * differs), and the checkout is not in an agent's scratch space
 * (`AGENT_SCRATCH_ROOTS`), where a full clone would pass the git test. Any
 * failure answers `false`.
 */
export const isMainCheckout = (
  cwd: string,
  o: { scratchRoots?: readonly string[] } = {}
): boolean => {
  try {
    const [gitDir, commonDir] = execFileSync(
      "git",
      ["rev-parse", "--git-dir", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
      .trim()
      .split("\n");
    if (!gitDir || !commonDir) return false;
    const git = resolve(cwd, gitDir);
    if (git !== resolve(cwd, commonDir)) return false;
    const scratch = o.scratchRoots ?? AGENT_SCRATCH_ROOTS;
    return !scratch.some((root) => isInside(git, root));
  } catch {
    return false;
  }
};

/**
 * The live-desk address a checkout's browser code is built with. An explicit
 * value (process env or `.env`, as `explicit` carries it) always wins — that is
 * how verify-cvm pins its runs. Otherwise the main checkout gets the live desk
 * and every other checkout the dead address.
 */
export const liveDeskAddresses = (opts: {
  mainCheckout: boolean;
  explicit: Record<string, string | undefined>;
}): { hub: string } => ({
  hub:
    opts.explicit[HUB_URL_ENV_KEY] ||
    (opts.mainCheckout ? LIVE_HUB_URL : DEAD_DESK_URL),
});

/**
 * Why the Stream Deck forwarder will not start in `cwd`, or `undefined` when
 * it may. It binds the hub's own ports (WS 5172, HTTP 5174), and the HTTP side
 * has no auth: a worktree's forwarder holding them would be Matt's hub to
 * anything that connects.
 */
export const forwarderRefusal = (
  cwd: string,
  o: { scratchRoots?: readonly string[] } = {}
): string | undefined =>
  isMainCheckout(cwd, o)
    ? undefined
    : "Stream Deck forwarder not started: this is not the main checkout of the repo. " +
      "The forwarder is Matt's live desk (WS 5172, HTTP 5174) and runs only from his main checkout, " +
      "so a worktree can never take its ports or relay his Stream Deck presses. " +
      "This worktree's editor is pointed at a dead address instead; nothing else is affected.";
