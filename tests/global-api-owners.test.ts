import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

const APIS = [
  { api: "fetch", use: "fetch", owner: "@/packages/http" },
  { api: "Date", use: "Date", owner: "@/packages/clock" },
  { api: "setTimeout", use: "setTimeout", owner: "@/packages/clock" },
  { api: "setInterval", use: "setInterval", owner: "@/packages/clock" },
  { api: "clearTimeout", use: "clearTimeout", owner: "@/packages/clock" },
  { api: "clearInterval", use: "clearInterval", owner: "@/packages/clock" },
  { api: "console", use: "console", owner: "@/packages/log" },
  { api: "localStorage", use: "localStorage", owner: "useLocalStorage" },
  { api: "process.env", use: "process.env", owner: "@/packages/env" },
  { api: "Math.random", use: "Math.random", owner: "@/packages/random" },
] as const;

type Api = (typeof APIS)[number]["api"];

const PROBE = [
  ...APIS.map(({ use }, i) => `export const use${i} = ${use};`),
  "export type OnlyAType = Date;",
  "export const annotated = (when: Date): Date => when;",
  "",
].join("\n");

const ALL: readonly Api[] = APIS.map(({ api }) => api);
const TIMERS: readonly Api[] = [
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
];

const FILES: Record<string, readonly Api[]> = {
  "apps/local/app/features/probe/probe.ts": [],
  "apps/local/app/features/probe/probe.test.ts": [],
  "packages/core/services/probe.test.ts": [],
  "apps/local/app/packages/env/lib/probe.ts": ["process.env"],
  "apps/local/app/packages/env/tests/probe.test.ts": [],
  "packages/core/db/database-url.ts": ["process.env"],
  "apps/local/app/packages/http/lib/probe.ts": ["fetch"],
  "apps/local/app/packages/http/tests/probe.test.ts": [],
  "apps/local/app/packages/clock/lib/probe.ts": ["Date", ...TIMERS],
  "apps/local/app/packages/clock/tests/probe.test.ts": [],
  "packages/core/features/time/london-time.ts": ["Date"],
  "apps/local/app/packages/random/lib/probe.ts": ["Math.random"],
  "apps/local/app/packages/log/lib/probe.ts": ["console"],
  "apps/local/app/packages/log/tests/probe.test.ts": [],
  "apps/local/app/hooks/use-local-storage.ts": ["localStorage"],
};

interface Diagnostic {
  filename: string;
  code: string;
  message: string;
  help?: string;
  labels: { span: { line: number } }[];
}

let dir: string;
let diagnostics: Diagnostic[];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "global-api-owners-"));
  copyFileSync(
    path.join(ROOT, ".oxlintrc.json"),
    path.join(dir, ".oxlintrc.json")
  );
  symlinkSync(path.join(ROOT, "lint"), path.join(dir, "lint"));
  mkdirSync(path.join(dir, "node_modules"));
  symlinkSync(
    realpathSync(path.join(ROOT, "node_modules/oxlint")),
    path.join(dir, "node_modules/oxlint")
  );
  for (const file of Object.keys(FILES)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), PROBE);
  }
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/oxlint/bin/oxlint",
      "--format",
      "json",
      ...Object.keys(FILES),
    ],
    { cwd: dir, encoding: "utf8" }
  );
  const report: { diagnostics: Diagnostic[] } = JSON.parse(run.stdout);
  diagnostics = report.diagnostics.filter((d) =>
    d.code.startsWith("eslint(no-restricted-")
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const bannedIn = (file: string) =>
  diagnostics
    .filter((d) => d.filename === file)
    .map(
      (d) => APIS[(d.labels[0]?.span.line ?? 0) - 1]?.api ?? "a type position"
    );

describe("one owner per global API", () => {
  it.each(Object.entries(FILES))("%s may use only %j", (file, allowed) => {
    expect(bannedIn(file).sort()).toEqual(
      ALL.filter((api) => !allowed.includes(api)).sort()
    );
  });

  it.each(APIS)("the ban on $api names its owner, $owner", ({ api, owner }) => {
    const line = APIS.findIndex((a) => a.api === api) + 1;
    const found = diagnostics.find(
      (d) =>
        d.filename === "apps/local/app/features/probe/probe.ts" &&
        d.labels[0]?.span.line === line
    );
    expect(`${found?.message} ${found?.help}`).toContain(owner);
  });
});
