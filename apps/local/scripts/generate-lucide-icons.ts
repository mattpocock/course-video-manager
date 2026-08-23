/**
 * Regenerate the vendored lucide icon table.
 *
 *   pnpm gen:lucide-icons -- --lucide 1.27.0
 *   pnpm gen:lucide-icons -- --lucide 0.525.0 --only chromium,codepen,…
 *
 * The lucide version is an ARGUMENT and the tarball is fetched at generation
 * time, so the repo carries no second permanent lucide dependency. The baseline
 * committed today is:
 *
 *   1. --lucide 1.27.0                                  (everything upstream has)
 *   2. --lucide 0.525.0 --only <BACKFILL_NAMES>         (the 19 permanent removals)
 *
 * Running it again against any version can only ADD names — see `appendIcons`
 * in `packages/lucide-icons/generator.ts`, which is where that invariant
 * lives and where it is tested. This file is only I/O.
 *
 * `--synonyms` additionally rewrites the alias map, which carries no
 * persistence contract (it widens what a search query matches and never
 * rewrites a stored name) and so is regenerated wholesale.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendIcons,
  parseIconModules,
  serialiseIconTable,
  type IconTable,
  type SynonymTable,
} from "../../../packages/lucide-icons/generator";

const GENERATED_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "lucide-icons",
  "lib",
  "generated"
);
const TABLE_PATH = path.join(GENERATED_DIR, "icon-nodes.json");
const SYNONYMS_PATH = path.join(GENERATED_DIR, "synonyms.json");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function fetchIconModules(version: string): Promise<Map<string, string>> {
  const url = `https://registry.npmjs.org/lucide-react/-/lucide-react-${version}.tgz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lucide-"));
  const tarball = path.join(tmp, "lucide.tgz");
  fs.writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  execFileSync("tar", ["-xzf", tarball, "-C", tmp]);

  const iconsDir = path.join(tmp, "package", "dist", "esm", "icons");
  const files = new Map<string, string>();
  for (const file of fs.readdirSync(iconsDir)) {
    const match = /^(.+)\.m?js$/.exec(file);
    if (!match || match[1] === "index") continue; // index is the barrel, not an icon
    files.set(match[1]!, fs.readFileSync(path.join(iconsDir, file), "utf8"));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  return files;
}

const version = flag("lucide");
if (!version) {
  console.error(
    "usage: gen:lucide-icons -- --lucide <version> [--only a,b,c] [--synonyms]"
  );
  process.exit(1);
}

const only = flag("only")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const withSynonyms = process.argv.includes("--synonyms");

const modules = await fetchIconModules(version);
const parsed = parseIconModules(modules);

const existing = readJson<IconTable>(TABLE_PATH, {});
const { table, added } = appendIcons(existing, parsed.icons, { only });

fs.mkdirSync(GENERATED_DIR, { recursive: true });
fs.writeFileSync(TABLE_PATH, serialiseIconTable(table));

console.log(
  `lucide ${version}: parsed ${Object.keys(parsed.icons).length} icons, ` +
    `${parsed.unparsed.length} unparsed. Added ${added.length}; ` +
    `table now holds ${Object.keys(table).length}.`
);

if (withSynonyms) {
  const synonyms: SynonymTable = {};
  for (const alias of Object.keys(parsed.synonyms).sort()) {
    const target = parsed.synonyms[alias]!;
    // An alias is only useful if its target survived into the frozen table.
    if (Object.prototype.hasOwnProperty.call(table, target)) {
      synonyms[alias] = target;
    }
  }
  // Carry forward aliases the current version no longer ships but whose target
  // is still in the table — the map is search-only, so more is strictly better.
  const previous = readJson<SynonymTable>(SYNONYMS_PATH, {});
  for (const [alias, target] of Object.entries(previous)) {
    if (
      !(alias in synonyms) &&
      Object.prototype.hasOwnProperty.call(table, target)
    ) {
      synonyms[alias] = target;
    }
  }
  const ordered: SynonymTable = {};
  for (const alias of Object.keys(synonyms).sort())
    ordered[alias] = synonyms[alias]!;
  fs.writeFileSync(SYNONYMS_PATH, JSON.stringify(ordered));
  console.log(`synonyms: ${Object.keys(ordered).length} aliases written.`);
}
