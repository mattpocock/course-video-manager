import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  configOverrides,
  type Diagnostic,
  isRecord,
  lintProbes,
  ownerPathExists,
  repoConfig,
  ROOT,
} from "./lint-probe.ts";

const RULE = "local(no-comments)";
const RULE_NAME = "local/no-comments";

const LINE_COMMENT = "export const answer = 42; // the answer\n";
const INTERFACE_JSDOC = [
  "/** The probe module. */",
  'import { x } from "./x";',
  "/** The answer. */",
  "export const answer = x;",
  "",
].join("\n");

const FILES: Record<string, [source: string, count: number]> = {
  "apps/local/app/features/probe/probe.ts": [LINE_COMMENT, 1],
  "apps/local/app/features/probe/probe.test.ts": [LINE_COMMENT, 1],
  "packages/core/services/probe.ts": [LINE_COMMENT, 1],
  "apps/local/app/packages/clock/index.ts": [LINE_COMMENT, 1],
  "apps/local/app/packages/probe/index.ts": [INTERFACE_JSDOC, 0],
  "apps/local/app/packages/probe/client.tsx": [INTERFACE_JSDOC, 0],
  "apps/local/app/packages/probe/lib/probe.ts": [INTERFACE_JSDOC, 2],
  "apps/local/app/packages/probe/tests/probe.test.ts": [INTERFACE_JSDOC, 2],
  "packages/lucide-icons/index.ts": [INTERFACE_JSDOC, 0],
  "packages/lucide-icons/lib/probe.ts": [INTERFACE_JSDOC, 2],
  "packages/overlay-renderer/src/render.ts": [INTERFACE_JSDOC, 0],
  "packages/core/db/probe.ts": [INTERFACE_JSDOC, 2],
  "apps/remote/probe.ts": [INTERFACE_JSDOC, 2],
  "apps/local/app/features/probe/interface.ts": [INTERFACE_JSDOC, 2],
};

const workspacePackages = () =>
  ["apps", "packages"].flatMap((dir) =>
    readdirSync(path.join(ROOT, dir)).map((name) => `${dir}/${name}`)
  );

const targetsOf = (entry: unknown): string[] => {
  if (typeof entry === "string") return [entry];
  if (Array.isArray(entry)) return entry.flatMap(targetsOf);
  if (isRecord(entry)) return Object.values(entry).flatMap(targetsOf);
  return [];
};

const exportedFiles = (pkg: string): string[] => {
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      readFileSync(path.join(ROOT, pkg, "package.json"), "utf8")
    );
  } catch {
    return [];
  }
  if (!isRecord(manifest)) return [];
  const { exports } = manifest;
  const isSubpathMap =
    isRecord(exports) && Object.keys(exports).some((k) => k.startsWith("."));
  const entries = isSubpathMap
    ? Object.entries(exports)
        .filter(([subpath]) => !subpath.includes("*"))
        .map(([, target]) => target)
    : [exports];
  return [...new Set(entries.flatMap(targetsOf))].map((target) =>
    path.posix.join(pkg, target)
  );
};

const APP_PACKAGE_ROOTS = "apps/local/app/packages/*/*.{ts,tsx}";

const appPackageRootFiles = () => {
  const dir = "apps/local/app/packages";
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((pkg) =>
      readdirSync(path.join(ROOT, dir, pkg.name)).map(
        (file) => `${dir}/${pkg.name}/${file}`
      )
    )
    .filter((file) => path.matchesGlob(file, APP_PACKAGE_ROOTS));
};

const entryPointOverrides = () =>
  configOverrides().filter((o) => RULE_NAME in o.rules);

let probes: ReturnType<typeof lintProbes>;
let diagnostics: Diagnostic[];

beforeAll(() => {
  probes = lintProbes(
    Object.fromEntries(
      Object.entries(FILES).map(([file, [source]]) => [file, source])
    )
  );
  diagnostics = probes.diagnostics.filter((d) => d.code === RULE);
});

afterAll(() => probes.remove());

describe("local/no-comments in the repo config", () => {
  it("is an error at the root", () => {
    expect(repoConfig().rules[RULE_NAME]).toBe("error");
  });

  it.each(Object.entries(FILES).map(([file, [, count]]) => [file, count]))(
    "%s reports %i comment(s)",
    (file, count) => {
      expect(diagnostics.filter((d) => d.filename === file)).toHaveLength(
        count
      );
    }
  );

  it("names where the meaning goes instead", () => {
    expect(diagnostics[0]?.message).toContain("a name, a type or a test");
    expect(diagnostics[0]?.message).toContain("ADR (docs/adr/)");
  });

  it("has one override, which allows interface JSDoc and stays an error", () => {
    const overrides = entryPointOverrides();
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.rules[RULE_NAME]).toEqual([
      "error",
      { allowInterfaceJsDoc: true },
    ]);
  });

  it("allows interface JSDoc only on entry points, with no test files", () => {
    const files = entryPointOverrides().flatMap((o) => o.files);
    const concrete = workspacePackages().flatMap(exportedFiles).sort();
    expect(concrete).not.toEqual([]);
    expect(files[0]).toBe(APP_PACKAGE_ROOTS);
    expect(files.slice(1).sort()).toEqual(concrete);
    const roots = appPackageRootFiles();
    expect(roots).toContain("apps/local/app/packages/clock/index.ts");
    for (const file of [...roots, ...files]) {
      expect(file).not.toMatch(/test/);
      expect(ownerPathExists(file), file).toBe(true);
    }
  });
});
