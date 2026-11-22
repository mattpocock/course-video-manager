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

const isConfig = (value: unknown): value is { overrides: Override[] } =>
  typeof value === "object" &&
  value !== null &&
  "overrides" in value &&
  Array.isArray(value.overrides);

const ownerOverrides = () => {
  const source = readFileSync(path.join(ROOT, ".oxlintrc.json"), "utf8");
  const config: unknown = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
  if (!isConfig(config)) throw new Error(".oxlintrc.json has no overrides");
  return config.overrides.filter((override) =>
    Object.keys(override.rules).some(
      (rule) =>
        OWNED_RULES.includes(rule) ||
        (rule === "no-restricted-imports" &&
          override.files.some((file) => file.includes("components/ui/")))
    )
  );
};

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
