import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");

export interface Diagnostic {
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

/**
 * Lints probe files with the repo's real `.oxlintrc.json` and local plugin,
 * in a throwaway directory: each key of `files` is a repo-relative path and
 * its value the source planted there. Returns Oxlint's diagnostics, and
 * `remove` to delete the directory.
 */
export const lintProbes = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "lint-probe-"));
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
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), source);
  }
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/oxlint/bin/oxlint",
      "--format",
      "json",
      ...Object.keys(files),
    ],
    { cwd: dir, encoding: "utf8" }
  );
  const report: unknown = JSON.parse(run.stdout);
  if (!isReport(report)) throw new Error(`not an Oxlint report: ${run.stdout}`);
  return {
    diagnostics: report.diagnostics,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
};

export interface Override {
  files: string[];
  rules: Record<string, unknown>;
}

const isOverride = (value: unknown): value is Override =>
  typeof value === "object" &&
  value !== null &&
  "files" in value &&
  Array.isArray(value.files) &&
  value.files.every((file) => typeof file === "string") &&
  "rules" in value &&
  typeof value.rules === "object" &&
  value.rules !== null;

export interface Config {
  rules: Record<string, unknown>;
  overrides: Override[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The repo's `.oxlintrc.json`, read with its comments stripped: its root
 * `rules` and its `overrides`. `configOverrides` is the overrides alone.
 * `ownerPathExists` is true when an override's file entry names something in
 * the repo: a path, or the folder a glob starts in.
 */
export const repoConfig = (): Config => {
  const source = readFileSync(path.join(ROOT, ".oxlintrc.json"), "utf8");
  const config: unknown = JSON.parse(
    source.replace(
      /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      (_, string: string | undefined) => string ?? ""
    )
  );
  if (!isRecord(config)) throw new Error(".oxlintrc.json is not an object");
  const { rules, overrides } = config;
  if (!isRecord(rules)) throw new Error(".oxlintrc.json has no rules");
  if (!Array.isArray(overrides) || !overrides.every(isOverride)) {
    throw new Error(".oxlintrc.json has no readable overrides");
  }
  return { rules, overrides };
};

export const configOverrides = (): Override[] => repoConfig().overrides;

export const ownerPathExists = (file: string) =>
  existsSync(path.join(ROOT, file.split("*")[0] ?? file));

/**
 * What a probe diagnostic bans: a local rule's name (`db-clients`), or
 * `import <module>` for a `no-restricted-imports` entry, with the
 * `use-effect-reducer` entry named by its banned import.
 */
export const banOf = (d: Diagnostic): string | undefined => {
  if (d.code.startsWith("local(")) return d.code.slice(6, -1);
  if (d.code !== "eslint(no-restricted-imports)") return undefined;
  const name = /'([^']+)'/.exec(d.message)?.[1];
  return name === "use-effect-reducer"
    ? "import useEffectReducer"
    : `import ${name}`;
};
