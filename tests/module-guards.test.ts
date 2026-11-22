import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Diagnostic, lintProbes, ROOT } from "./lint-probe.ts";

const PROBE = [
  'import { toast } from "sonner";',
  'import { useEffectReducer } from "use-effect-reducer";',
  'import { Pool } from "pg";',
  'import { createReadStream } from "node:fs";',
  "export const dir = __dirname;",
  "export const body = (stream: unknown) => new Response(stream as any);",
  "export const used = [toast, useEffectReducer, Pool, createReadStream];",
  "",
].join("\n");

type Ban =
  | "no-cjs-paths"
  | "response-body"
  | "routes-folder"
  | "import sonner"
  | "import pg"
  | "import useEffectReducer";

const EVERYWHERE: readonly Ban[] = [
  "no-cjs-paths",
  "response-body",
  "import sonner",
  "import pg",
  "import useEffectReducer",
];
const without = (bans: readonly Ban[], ...lifted: Ban[]) =>
  bans.filter((ban) => !lifted.includes(ban));

const ROUTES = "apps/local/app/routes";

const FILES: Record<string, readonly Ban[]> = {
  "apps/local/app/features/probe.ts": EVERYWHERE,
  "apps/local/app/features/probe.test.ts": EVERYWHERE,
  "apps/local/app/features/diagrams/probe.tsx": EVERYWHERE,
  "apps/local/scripts/probe.ts": EVERYWHERE,
  "packages/core/services/drizzle-service.server.ts": without(
    EVERYWHERE,
    "import pg"
  ),
  "apps/local/app/components/ui/toast.test.ts": EVERYWHERE,
  "apps/local/app/components/ui/toast.tsx": without(
    EVERYWHERE,
    "import sonner"
  ),
  "apps/local/app/components/ui/sonner.tsx": without(
    EVERYWHERE,
    "import sonner"
  ),
  "apps/local/app/services/web-file-stream.server.ts": without(
    EVERYWHERE,
    "response-body"
  ),
  "apps/local/app/services/whisper-transcription-service.ts": EVERYWHERE,
  [`${ROUTES}/api.probe.ts`]: EVERYWHERE,
  [`${ROUTES}/_app.probe.tsx`]: EVERYWHERE,
  [`${ROUTES}/api.probe.test.ts`]: [...EVERYWHERE, "routes-folder"],
  [`${ROUTES}/_app.probe.spec.tsx`]: [...EVERYWHERE, "routes-folder"],
  [`${ROUTES}/probe-utils.ts`]: [...EVERYWHERE, "routes-folder"],
  [`${ROUTES}/probe.helpers.tsx`]: [...EVERYWHERE, "routes-folder"],
  [`${ROUTES}/__tests__/probe.ts`]: [...EVERYWHERE, "routes-folder"],
  "apps/local/app/features/probe-utils.ts": EVERYWHERE,
};

const banOf = (d: Diagnostic): string | undefined => {
  if (d.code.startsWith("local(")) return d.code.slice(6, -1);
  if (d.code !== "eslint(no-restricted-imports)") return undefined;
  const name = /'([^']+)'/.exec(d.message)?.[1];
  return name === "use-effect-reducer"
    ? "import useEffectReducer"
    : `import ${name}`;
};

const GUARDED: ReadonlySet<string> = new Set(
  EVERYWHERE.concat("routes-folder")
);

let diagnostics: Diagnostic[];
let removeProbes: () => void;

beforeAll(() => {
  const probes = lintProbes(
    Object.fromEntries(Object.keys(FILES).map((file) => [file, PROBE]))
  );
  removeProbes = probes.remove;
  diagnostics = probes.diagnostics;
});

afterAll(() => {
  removeProbes();
});

const reportsIn = (file: string) =>
  diagnostics.filter((d) => d.filename === file);

describe("the module and file guards and their owners", () => {
  it.each(Object.entries(FILES))("%s fails exactly %j", (file, bans) => {
    const found = reportsIn(file)
      .map(banOf)
      .filter((ban) => ban !== undefined && GUARDED.has(ban));
    expect([...new Set(found)].sort()).toEqual([...bans].sort());
  });

  it("reports a routes-folder file once, and each CJS path, stream reference and cast once", () => {
    const counts = (file: string) =>
      Object.groupBy(reportsIn(file).map(banOf), (ban) => ban ?? "other");
    const found = counts(`${ROUTES}/api.probe.test.ts`);
    expect(found["routes-folder"]).toHaveLength(1);
    expect(found["no-cjs-paths"]).toHaveLength(1);
    expect(found["response-body"]).toHaveLength(3);
  });

  it.each([
    ["no-cjs-paths", "import.meta.dirname"],
    ["no-cjs-paths", "import.meta.filename"],
    ["response-body", "webFileStream"],
    ["response-body", "Readable.toWeb"],
    ["response-body", "undici"],
    ["routes-folder", "public routing"],
    ["routes-folder", "next to the feature it serves"],
    ["import sonner", "@/components/ui/toast"],
    ["import sonner", "toastError(error, fallback)"],
  ] as const)("the %s message names %s", (ban, guidance) => {
    const found = reportsIn(`${ROUTES}/api.probe.test.ts`).filter(
      (d) => banOf(d) === ban
    );
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) {
      expect(`${d.message} ${d.help ?? ""}`).toContain(guidance);
    }
  });
});

interface Override {
  files: string[];
  rules: Record<string, unknown>;
}

const OWNED_RULES = ["local/response-body", "local/routes-folder"];

interface Config {
  rules: Record<string, unknown>;
  overrides: Override[];
}

const isConfig = (value: unknown): value is Config =>
  typeof value === "object" &&
  value !== null &&
  "rules" in value &&
  "overrides" in value &&
  Array.isArray(value.overrides);

const readConfig = () => {
  const source = readFileSync(path.join(ROOT, ".oxlintrc.json"), "utf8");
  const config: unknown = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
  if (!isConfig(config)) throw new Error(".oxlintrc.json has no overrides");
  return config;
};

const ownerOverrides = () =>
  readConfig().overrides.filter((override) =>
    Object.keys(override.rules).some(
      (rule) =>
        OWNED_RULES.includes(rule) ||
        (rule === "no-restricted-imports" &&
          override.files.some((file) => file.includes("components/ui/")))
    )
  );

describe("the module and file guards' owner overrides", () => {
  it("cover the toast wrappers, the stream owner and the routes folder", () => {
    expect(
      ownerOverrides()
        .flatMap((o) => o.files)
        .sort()
    ).toEqual([
      "apps/local/app/components/ui/sonner.tsx",
      "apps/local/app/components/ui/toast.tsx",
      "apps/local/app/routes/**",
      "apps/local/app/services/web-file-stream.server.ts",
    ]);
  });

  it.each(ownerOverrides().flatMap((o) => o.files))(
    "%s exists in the repo",
    (file) => {
      expect(existsSync(path.join(ROOT, file.split("*")[0] ?? file))).toBe(
        true
      );
    }
  );
});

interface RestrictedPath {
  name: string;
}

const isRestrictedPath = (value: unknown): value is RestrictedPath =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string";

const restrictedPaths = (setting: unknown): RestrictedPath[] => {
  if (!Array.isArray(setting)) return [];
  const options: unknown = setting[1];
  if (typeof options !== "object" || options === null) return [];
  if (!("paths" in options) || !Array.isArray(options.paths)) return [];
  return options.paths.filter(isRestrictedPath);
};

const DB_PACKAGES = [
  "pg",
  "postgres",
  "@neondatabase/serverless",
  "@electric-sql/pglite",
  "drizzle-orm/node-postgres",
  "drizzle-orm/postgres-js",
  "drizzle-orm/neon-http",
  "drizzle-orm/neon-serverless",
  "drizzle-orm/pglite",
];

interface Relist {
  lifts: string[];
  rewords: string[];
  why: string;
}

const RELISTS: Record<string, Relist> = {
  "apps/local/app/features/diagrams/**": {
    lifts: [],
    rewords: ["sonner"],
    why: "Toasts are off on the Diagram Playground, so its sonner entry names usePlaygroundStatus() instead of the toast module.",
  },
  "apps/local/scripts/**": {
    lifts: [],
    rewords: [],
    why: "Adds the @cvm/core/db/database-url ban for DB scripts.",
  },
  "packages/core/services/drizzle-service.server.ts": {
    lifts: DB_PACKAGES,
    rewords: [],
    why: "The database client owners that import a client package.",
  },
  "apps/local/app/components/ui/sonner.tsx": {
    lifts: ["sonner"],
    rewords: [],
    why: "The toast wrappers, the only files that import sonner.",
  },
};

const importOverrides = () =>
  readConfig().overrides.filter(
    (override) => override.rules["no-restricted-imports"] !== undefined
  );

describe("every override that sets no-restricted-imports", () => {
  it("is listed, with why, and the root entries it lifts or rewords", () => {
    for (const relist of Object.values(RELISTS)) {
      expect(relist.why).not.toBe("");
    }
    expect(
      importOverrides()
        .map((o) => o.files[0])
        .sort()
    ).toEqual(Object.keys(RELISTS).sort());
  });

  it.each(importOverrides().map((o) => [o.files[0] ?? "", o] as const))(
    "%s re-lists every root entry it keeps, word for word",
    (first, override) => {
      const { lifts, rewords } = RELISTS[first] ?? {
        lifts: [],
        rewords: [],
        why: "",
      };
      const own = restrictedPaths(override.rules["no-restricted-imports"]);
      const kept = restrictedPaths(
        readConfig().rules["no-restricted-imports"]
      ).filter((entry) => !lifts.includes(entry.name));
      for (const entry of kept) {
        const copy = own.find((o) => o.name === entry.name);
        if (rewords.includes(entry.name)) expect(copy).toBeDefined();
        else expect(copy).toEqual(entry);
      }
      expect(own.map((o) => o.name).filter((n) => lifts.includes(n))).toEqual(
        []
      );
    }
  );
});
