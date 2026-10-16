import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Two verify-cvm runs launched at the same moment from two worktrees, and
 * every run-scoped verb from one aimed at the other.
 *
 * Parallel agents once drove each other's browser sessions because a verb
 * could find "the" run on its own. Now every verb takes the run id `launch`
 * printed, and a run belongs to the worktree that launched it. This drives the
 * real `verify.sh` in `--production` mode against a stand-in dev server and a
 * stand-in `agent-browser` that only logs what it was asked, so it needs no
 * database, no Chromium and no `.env` of Matt's.
 */
const VERIFY_SH = join(
  import.meta.dirname,
  "..",
  ".claude/skills/verify-cvm/scripts/verify.sh"
);

const FAKE_SERVER = `#!/usr/bin/env node
const http = require("http");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const env = process.env;
require("fs").writeFileSync(
  "server-env.json",
  JSON.stringify({ hub: env.VITE_STREAM_DECK_HUB_URL }),
);
// Stands in for Vite serving app/lib/live-channels.ts with the env inlined.
// FAKE_LEAKY_SERVER plays a server that ignored the env and kept Matt's hub.
const leaky = env.FAKE_LEAKY_SERVER === "1";
const hub = leaky ? "ws://localhost:5172" : env.VITE_STREAM_DECK_HUB_URL;
const server = http.createServer((req, res) =>
  res.end(
    req.url === "/app/lib/live-channels.ts"
      ? 'export const S = "' + hub + '";'
      : "ok",
  ),
);
server.on("error", (e) => { console.error(String(e)); process.exit(1); });
server.listen(port, () => console.log("  Local:   http://localhost:" + port + "/"));
`;

const FAKE_AGENT_BROWSER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$AB_LOG"
`;

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

let root: string;
let wtA: string;
let wtB: string;
let abLog: string;
let env: NodeJS.ProcessEnv;

const run = (cwd: string, ...args: string[]): Promise<Result> =>
  new Promise((resolve) => {
    const child = spawn("bash", [VERIFY_SH, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

const abCalls = () =>
  existsSync(abLog) ? readFileSync(abLog, "utf8").trim().split("\n") : [];

const alive = (dir: string) => {
  const pid = Number(readFileSync(join(dir, "server.pid"), "utf8"));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const makeCheckout = (dir: string) => {
  const bin = join(dir, "apps/local/node_modules/.bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "react-router"), FAKE_SERVER);
  chmodSync(join(bin, "react-router"), 0o755);
  writeFileSync(
    join(dir, ".env"),
    "DATABASE_URL=postgresql://u:p@fake.psdb.cloud/cvm\n"
  );
};

let a: { id: string; dir: string; port: string };
let b: { id: string; dir: string; port: string };

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "verify-isolation-"));
  wtA = join(root, "a");
  wtB = join(root, "b");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "ignore" });
  mkdirSync(wtA);
  git(wtA, "init", "-q", "-b", "main");
  git(
    wtA,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init"
  );
  git(wtA, "worktree", "add", "-q", wtB, "-b", "b");
  makeCheckout(wtA);
  makeCheckout(wtB);

  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "agent-browser"), FAKE_AGENT_BROWSER);
  chmodSync(join(bin, "agent-browser"), 0o755);
  abLog = join(root, "agent-browser.log");
  env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AB_LOG: abLog };
  delete env.VERIFY_PORT;

  // Launched together, so they race for the same first free port.
  const [la, lb] = await Promise.all([
    run(wtA, "launch", "--production"),
    run(wtB, "launch", "--production"),
  ]);
  expect(la.code, la.stderr).toBe(0);
  expect(lb.code, lb.stderr).toBe(0);
  const parse = (wt: string, r: Result) => {
    const id = r.stdout.trim();
    const dir = join(wt, ".verify", `run-${id}`);
    return {
      id,
      dir,
      port: readFileSync(join(dir, "server.port"), "utf8").trim(),
    };
  };
  a = parse(wtA, la);
  b = parse(wtB, lb);
}, 120_000);

afterAll(async () => {
  if (wtA) await run(wtA, "cleanup", "--all");
  if (wtB) await run(wtB, "cleanup", "--all");
  if (root) rmSync(root, { recursive: true, force: true });
}, 60_000);

describe("verify-cvm: concurrent runs are addressed by id and owned by their worktree", () => {
  it("gives each run its own id, port, browser session and evidence directory", () => {
    expect(a.id).not.toBe(b.id);
    expect(a.port).not.toBe(b.port);
    expect(readFileSync(join(a.dir, "browser-session"), "utf8")).not.toBe(
      readFileSync(join(b.dir, "browser-session"), "utf8")
    );
    expect(existsSync(a.dir) && existsSync(b.dir)).toBe(true);
  });

  it("resolves a run's own id to its own server", async () => {
    expect((await run(wtA, "url", a.id)).stdout.trim()).toBe(
      `http://localhost:${a.port}`
    );
    expect((await run(wtA, "dir", a.id)).stdout.trim()).toBe(a.dir);
  });

  it("refuses a verb with no run id — there is no default run", async () => {
    for (const verb of ["url", "session", "doctor", "ab", "shot", "cleanup"]) {
      const r = await run(wtA, verb);
      expect(r.code, verb).not.toBe(0);
      expect(r.stderr, verb).toContain("no run id");
    }
  });

  it("refuses every run-scoped verb from A aimed at B, by id or by path", async () => {
    const before = abCalls().length;
    const attempts: string[][] = [
      ["url", b.id],
      ["dir", b.id],
      ["session", b.id],
      ["doctor", b.id],
      ["guard", b.id, "baseline"],
      ["guard", b.id, "check"],
      ["sql", b.id, "select 1"],
      ["ab", b.id, "open", "/"],
      ["shot", b.id, "stolen"],
      ["snap", b.id, "stolen"],
      ["cleanup", b.id],
      ["url", b.dir],
      ["cleanup", b.dir],
    ];
    for (const args of attempts) {
      const r = await run(wtA, ...args);
      expect(r.code, args.join(" ")).not.toBe(0);
      expect(r.stderr, args.join(" ")).toMatch(/no run|another checkout/);
    }
    expect(abCalls().length).toBe(before);
    expect(alive(b.dir)).toBe(true);
    expect(existsSync(join(b.dir, "guard-since.txt"))).toBe(false);
  });

  it("refuses B's run even when it sits in A's run root (a shared or symlinked .verify)", async () => {
    symlinkSync(b.dir, join(wtA, ".verify", `run-${b.id}`));
    const r = await run(wtA, "ab", b.id, "open", "/");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("refusing to touch another agent's run");
    rmSync(join(wtA, ".verify", `run-${b.id}`));
  });

  it("pins A's browser verbs to A's session, server and evidence directory", async () => {
    const session = readFileSync(join(a.dir, "browser-session"), "utf8").trim();
    expect((await run(wtA, "ab", a.id, "open", "/courses")).code).toBe(0);
    expect((await run(wtA, "shot", a.id, "01-before")).code).toBe(0);
    expect(abCalls().slice(-2)).toEqual([
      `--session ${session} open http://localhost:${a.port}/courses`,
      `--session ${session} screenshot ${a.dir}/01-before.png`,
    ]);

    const elsewhere = await run(
      wtA,
      "ab",
      a.id,
      "open",
      `http://localhost:${b.port}/`
    );
    expect(elsewhere.stderr).toContain("not this run's server");
    const otherSession = await run(
      wtA,
      "ab",
      a.id,
      "--session",
      "x",
      "open",
      "/"
    );
    expect(otherSession.stderr).toContain("not yours to set");
    const escape = await run(wtA, "shot", a.id, "../../escape");
    expect(escape.stderr).toContain("plain file name");
  });

  it("cleanup --all stops only this worktree's runs", async () => {
    expect((await run(wtA, "cleanup", "--all")).code).toBe(0);
    expect(alive(a.dir)).toBe(false);
    expect(alive(b.dir)).toBe(true);
  });

  it("refuses a run whose pages would still join Matt's Stream Deck hub", async () => {
    const saved = env;
    env = { ...env, FAKE_LEAKY_SERVER: "1" };
    const r = await run(wtA, "launch", "--production");
    env = saved;
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("Stream Deck hub");
    expect(r.stdout.trim()).toBe("");
  }, 60_000);

  it("keeps every run off Matt's Stream Deck hub", () => {
    for (const wt of [wtA, wtB]) {
      const env = JSON.parse(
        readFileSync(join(wt, "apps/local/server-env.json"), "utf8")
      );
      expect(env).toEqual({ hub: "ws://127.0.0.1:9" });
    }
  });

  it("leaves nothing addressing the live desk except the files gated to the main checkout", () => {
    // Every spelling of Matt's hub (WS 5172), its unauthenticated HTTP side
    // (5174) and OBS (4455), across the app, the forwarder, the Chrome
    // extension's folder and the agent skills. A skill line telling an agent to
    // `curl localhost:5174/api/…` is as live as code, so skill Markdown counts
    // in full; in code, comments do not.
    const desk = String.raw`(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(5172|5174|4455)\b`;
    const allowed: Record<string, string> = {
      // The one place the live addresses are named; handed out only to the
      // main checkout.
      "apps/local/live-desk/live-desk.ts": "isMainCheckout",
      // Runs inside Matt's Chrome, not a checkout: it can only ever reach the
      // hub his own main checkout serves.
      "apps/local/chrome-extension/background.js": "",
      // A dev script that sends to the hub — refuses outside the main checkout.
      "apps/local/chrome-extension/dev-send-events.ts":
        "isMainCheckout(process.cwd())",
    };
    const repo = join(import.meta.dirname, "..");
    const files = execFileSync(
      "git",
      [
        "grep",
        "-lE",
        desk,
        "--",
        "apps/local/app",
        "apps/local/live-desk",
        "apps/local/stream-deck-forwarder/*.ts",
        "apps/local/chrome-extension",
        ".claude/skills",
        "apps/local/vite.config.ts",
        ":!*.test.ts",
      ],
      { cwd: repo, encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(files).toContain("apps/local/chrome-extension/background.js");

    const re = new RegExp(desk);
    const live = files.filter((f) => {
      const lines = readFileSync(join(repo, f), "utf8").split("\n");
      const skillProse = f.startsWith(".claude/skills/") && f.endsWith(".md");
      // A human-facing README outside the skills describes the desk; it does
      // not drive it.
      if (f.endsWith(".md") && !skillProse) return false;
      const code = skillProse
        ? lines
        : lines.filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l));
      return code.some((l) => re.test(l));
    });
    const unguarded = live.filter(
      (f) =>
        !(f in allowed) ||
        !readFileSync(join(repo, f), "utf8").includes(allowed[f]!)
    );
    expect(unguarded).toEqual([]);
  });
});
