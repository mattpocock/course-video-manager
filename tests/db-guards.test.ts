import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  configOverrides,
  type Diagnostic,
  lintProbes,
  ownerPathExists,
} from "./lint-probe.ts";

const PROBE_LINES = [
  'import { resolveDatabaseUrl } from "@cvm/core/db/database-url";',
  'import { useEffectReducer } from "use-effect-reducer";',
  'import { Pool as P } from "pg";',
  'import * as pgx from "drizzle-orm/node-postgres";',
  'import type { PoolClient } from "pg"; // ts',
  "export const pool = new Pool({ connectionString: resolveDatabaseUrl() });",
  "export const aliased = (c: PoolClient) => [new P(), pgx, c]; // ts",
  "export const aliased = (c) => [new P(), pgx, c]; // js",
  "export const url = process.env.DATABASE_URL;",
  "export const load = () => process.loadEnvFile();",
  "export const insert = () => db.insert(clips).values([]);",
  "export const reducer = useEffectReducer;",
  "",
];

const probeFor = (file: string) => {
  const drop = file.endsWith(".mjs") ? " // ts" : " // js";
  return PROBE_LINES.filter((line) => !line.endsWith(drop))
    .map((line) => line.replace(/ \/\/ (ts|js)$/, ""))
    .join("\n");
};

type Ban =
  | "db-clients"
  | "script-db-url"
  | "clip-inserts"
  | "import pg"
  | "import drizzle-orm/node-postgres"
  | "import @cvm/core/db/database-url"
  | "import useEffectReducer";

const EVERYWHERE: readonly Ban[] = [
  "db-clients",
  "clip-inserts",
  "import pg",
  "import drizzle-orm/node-postgres",
  "import useEffectReducer",
];
const IN_SCRIPTS: readonly Ban[] = [
  ...EVERYWHERE,
  "script-db-url",
  "import @cvm/core/db/database-url",
];
const without = (bans: readonly Ban[], ...lifted: Ban[]) =>
  bans.filter((ban) => !lifted.includes(ban));
const CLIENT_IMPORTS: Ban[] = ["import pg", "import drizzle-orm/node-postgres"];

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
    "import useEffectReducer",
  ],
  "packages/core/services/drizzle-service.server.ts": without(
    EVERYWHERE,
    "db-clients",
    ...CLIENT_IMPORTS
  ),
  "packages/core/test-utils/test-postgres.ts": without(
    EVERYWHERE,
    "db-clients",
    ...CLIENT_IMPORTS
  ),
  "apps/remote/scripts/migrate-on-deploy.mjs": without(
    EVERYWHERE,
    "db-clients",
    ...CLIENT_IMPORTS
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

const banOf = (d: Diagnostic): string | undefined => {
  const local = /^local\((db-clients|clip-inserts|script-db-url)\)$/.exec(
    d.code
  );
  if (local) return local[1];
  if (d.code !== "eslint(no-restricted-imports)") return undefined;
  return `import ${/'([^']+)'/.exec(d.message)?.[1]}`;
};

let diagnostics: Diagnostic[];
let removeProbes: () => void;

beforeAll(() => {
  const probes = lintProbes(
    Object.fromEntries(Object.keys(FILES).map((file) => [file, probeFor(file)]))
  );
  removeProbes = probes.remove;
  diagnostics = probes.diagnostics;
});

afterAll(() => {
  removeProbes();
});

const reportsIn = (file: string) =>
  diagnostics.filter((d) => d.filename === file);

describe("the database guards and their owners", () => {
  it.each(Object.entries(FILES))("%s fails exactly %j", (file, bans) => {
    const found = reportsIn(file)
      .map(banOf)
      .filter((ban) => ban !== undefined);
    expect([...new Set(found)].sort()).toEqual([...bans].sort());
  });

  it("reports a DATABASE_URL read once: db-clients outside the DB scripts, script-db-url inside them", () => {
    const urlReports = (file: string) =>
      reportsIn(file).filter(
        (d) => d.code.startsWith("local(") && d.message.includes("database URL")
      );
    expect(
      urlReports("apps/local/app/services/probe.ts").map((d) => d.code)
    ).toEqual(["local(db-clients)"]);
    expect(
      urlReports("apps/local/scripts/probe.ts").map((d) => d.code)
    ).toEqual(["local(script-db-url)"]);
  });

  it.each([
    ["db-clients", "DrizzleService"],
    ["db-clients", "scriptPgClient() / scriptDrizzle()"],
    ["db-clients", "createTestDb()"],
    ["db-clients", "resolveDatabaseUrl()"],
    ["import pg", "scriptPgClient() / scriptDrizzle()"],
    ["import drizzle-orm/node-postgres", "DrizzleService"],
    ["script-db-url", "scriptDatabaseUrl()"],
    ["import @cvm/core/db/database-url", "scriptDatabaseUrl()"],
    ["clip-inserts", "copyClipsOntoVideo"],
    ["clip-inserts", "COPY_PATHS"],
  ] as const)("the %s message names %s", (ban, guidance) => {
    const found = reportsIn("apps/local/scripts/probe.ts").find(
      (d) => banOf(d) === ban
    );
    expect(`${found?.message} ${found?.help}`).toContain(guidance);
  });
});

const OWNED_RULES = [
  "local/db-clients",
  "local/script-db-url",
  "local/clip-inserts",
];

const ownerOverrides = () =>
  configOverrides().filter((override) =>
    Object.keys(override.rules).some(
      (rule) =>
        OWNED_RULES.includes(rule) ||
        (rule === "no-restricted-imports" &&
          override.files.some((file) => FILES[file] !== undefined))
    )
  );

describe("the database guards' owner overrides", () => {
  it("cover every owner this suite probes", () => {
    const listed = new Set(ownerOverrides().flatMap((o) => o.files));
    for (const file of Object.keys(FILES).filter((f) => !f.includes("probe"))) {
      expect(listed).toContain(file);
    }
  });

  it.each(ownerOverrides().flatMap((o) => o.files))(
    "%s exists in the repo",
    (file) => {
      expect(ownerPathExists(file)).toBe(true);
    }
  );
});
