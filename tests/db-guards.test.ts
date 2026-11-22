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

const PROBE = [
  'import { resolveDatabaseUrl } from "@cvm/core/db/database-url";',
  'import { useEffectReducer } from "use-effect-reducer";',
  "export const pool = new Pool({ connectionString: resolveDatabaseUrl() });",
  "export const url = process.env.DATABASE_URL;",
  "export const load = () => process.loadEnvFile();",
  "export const insert = () => db.insert(clips).values([]);",
  "export const reducer = useEffectReducer;",
  "",
].join("\n");

type Ban =
  | "db-clients"
  | "script-db-url"
  | "clip-inserts"
  | "import database-url"
  | "import use-effect-reducer";

const EVERYWHERE: readonly Ban[] = [
  "db-clients",
  "clip-inserts",
  "import use-effect-reducer",
];
const IN_SCRIPTS: readonly Ban[] = [
  ...EVERYWHERE,
  "script-db-url",
  "import database-url",
];
const without = (bans: readonly Ban[], lifted: Ban) =>
  bans.filter((ban) => ban !== lifted);

const FILES: Record<string, readonly Ban[]> = {
  "apps/local/app/services/probe.ts": EVERYWHERE,
  "apps/local/app/services/probe.test.ts": EVERYWHERE,
  "packages/core/services/probe.test.ts": EVERYWHERE,
  "packages/core/test-utils/probe.ts": EVERYWHERE,
  "apps/local/scripts/probe.ts": IN_SCRIPTS,
  "apps/local/scripts/probe.test.ts": IN_SCRIPTS,
  "apps/local/scripts/recorder-scorecard/probe.ts": IN_SCRIPTS,
  "packages/core/scripts/probe.mjs": IN_SCRIPTS,
  "apps/local/scripts/script-database-url.ts": [
    "clip-inserts",
    "import use-effect-reducer",
  ],
  "packages/core/services/drizzle-service.server.ts": without(
    EVERYWHERE,
    "db-clients"
  ),
  "packages/core/test-utils/test-postgres.ts": without(
    EVERYWHERE,
    "db-clients"
  ),
  "apps/remote/scripts/migrate-on-deploy.mjs": without(
    EVERYWHERE,
    "db-clients"
  ),
  ".claude/skills/verify-cvm/scripts/migrate-clone.mjs": without(
    EVERYWHERE,
    "db-clients"
  ),
  "packages/core/services/copy-child-rows.ts": without(
    EVERYWHERE,
    "clip-inserts"
  ),
  "packages/core/services/db-version-copy.server.ts": without(
    EVERYWHERE,
    "clip-inserts"
  ),
  "packages/core/services/db-course-duplicate.server.ts": without(
    EVERYWHERE,
    "clip-inserts"
  ),
  "packages/core/services/db-clip-operations.server.ts": without(
    EVERYWHERE,
    "clip-inserts"
  ),
  "packages/core/services/db-short-create.server.ts": without(
    EVERYWHERE,
    "clip-inserts"
  ),
  "apps/local/app/services/clip-service-handler.helpers.ts": without(
    EVERYWHERE,
    "clip-inserts"
  ),
  "packages/core/services/db-overlay-operations.server.ts": without(
    EVERYWHERE,
    "clip-inserts"
  ),
  "packages/core/services/db-transcript-word-operations.server.ts": without(
    EVERYWHERE,
    "clip-inserts"
  ),
};

interface Diagnostic {
  filename: string;
  code: string;
  message: string;
  help?: string;
}

const isReport = (value: unknown): value is { diagnostics: Diagnostic[] } =>
  typeof value === "object" &&
  value !== null &&
  "diagnostics" in value &&
  Array.isArray(value.diagnostics);

const banOf = (d: Diagnostic): Ban | undefined => {
  if (d.code === "local(db-clients)") return "db-clients";
  if (d.code === "local(script-db-url)") return "script-db-url";
  if (d.code === "local(clip-inserts)") return "clip-inserts";
  if (d.code !== "eslint(no-restricted-imports)") return undefined;
  return `${d.message} ${d.help}`.includes("use-effect-reducer")
    ? "import use-effect-reducer"
    : "import database-url";
};

let dir: string;
let diagnostics: Diagnostic[];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "db-guards-"));
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
  const report: unknown = JSON.parse(run.stdout);
  if (!isReport(report)) throw new Error(`not an Oxlint report: ${run.stdout}`);
  diagnostics = report.diagnostics;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the database guards and their owners", () => {
  it.each(Object.entries(FILES))("%s fails exactly %j", (file, bans) => {
    const found = diagnostics
      .filter((d) => d.filename === file)
      .map(banOf)
      .filter((ban) => ban !== undefined);
    expect([...new Set(found)].sort()).toEqual([...bans].sort());
  });

  it.each([
    ["db-clients", "DrizzleService"],
    ["db-clients", "scriptPgClient() / scriptDrizzle()"],
    ["db-clients", "createTestDb()"],
    ["db-clients", "resolveDatabaseUrl()"],
    ["script-db-url", "scriptDatabaseUrl()"],
    ["import database-url", "scriptDatabaseUrl()"],
    ["clip-inserts", "copyClipsOntoVideo"],
    ["clip-inserts", "COPY_PATHS"],
  ] as const)("the %s message names %s", (ban, guidance) => {
    const found = diagnostics.find(
      (d) => d.filename === "apps/local/scripts/probe.ts" && banOf(d) === ban
    );
    expect(`${found?.message} ${found?.help}`).toContain(guidance);
  });
});
