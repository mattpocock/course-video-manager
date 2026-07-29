// Entry point (public) — the generator's pure core.
//
// The icon table is COMMITTED DATA, not a dependency range: a Diagram stores an
// icon *name*, and a DiagramSnapshot is the state a Clip was filmed against, so
// the geometry behind a name must never change. Lucide ships `semver -i minor`
// for every release and has silently moved icon geometry under an unchanged
// name, so the set is vendored and frozen here instead of tracked.
//
// Everything in this file is pure. The I/O half of the generator — fetching a
// named lucide tarball, unpacking it, writing the JSON — lives in
// `scripts/generate-lucide-icons.ts`, so the invariant below is testable in
// Node with no network.

/** One lucide primitive: an SVG tag plus its attributes. */
export type IconPrimitive = [
  tag: string,
  attrs: Record<string, string | number>,
];

/** A whole icon, in lucide's own vocabulary. Exactly what upstream authored. */
export type IconNode = IconPrimitive[];

export type IconTable = Record<string, IconNode>;

/** alias name -> the canonical name it resolves to. Search-only; never stored. */
export type SynonymTable = Record<string, string>;

/**
 * Strip React `key` attributes. That is the ONLY normalisation applied: the
 * primitives stay in lucide's vocabulary (`path`, `circle`, `rect`, `line`,
 * `polyline`, `polygon`, `ellipse`) and the numbers stay exactly as written, so
 * the committed diff reads as lucide wrote it. Transpiling to tldraw geometry
 * happens downstream of the freeze — see `./tldraw`.
 */
export function normaliseIconNode(node: IconNode): IconNode {
  return node.map(([tag, attrs]) => {
    const rest: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "key") continue;
      rest[k] = v;
    }
    return [tag, rest] satisfies IconPrimitive;
  });
}

const ICON_NODE_RE = /const __iconNode = (\[[\s\S]*?\]);\r?\n/;
const ALIAS_RE = /export \{ default \} from '\.\/([a-z0-9-]+)\.m?js'/;

/**
 * Parse one lucide-react ESM icon module. Returns either the icon's geometry,
 * or — for the ~250 alias modules that only re-export another icon — the
 * canonical name it points at.
 */
export function parseIconModule(
  source: string
): { kind: "icon"; node: IconNode } | { kind: "alias"; target: string } | null {
  const alias = ALIAS_RE.exec(source);
  if (alias) return { kind: "alias", target: alias[1]! };

  const match = ICON_NODE_RE.exec(source);
  if (!match) return null;

  // The module is a static ESM file of literals; there is nothing to execute.
  const node = new Function(`return ${match[1]}`)() as IconNode;
  return { kind: "icon", node: normaliseIconNode(node) };
}

/**
 * Parse a whole `dist/esm/icons` directory, keyed by file name without its
 * extension (lucide's kebab-case icon name).
 */
export function parseIconModules(files: ReadonlyMap<string, string>): {
  icons: IconTable;
  synonyms: SynonymTable;
  unparsed: string[];
} {
  const icons: IconTable = {};
  const synonyms: SynonymTable = {};
  const unparsed: string[] = [];

  for (const [name, source] of files) {
    const parsed = parseIconModule(source);
    if (!parsed) {
      unparsed.push(name);
      continue;
    }
    if (parsed.kind === "alias") synonyms[name] = parsed.target;
    else icons[name] = parsed.node;
  }

  return { icons, synonyms, unparsed };
}

/**
 * THE append-only invariant, in one function.
 *
 * It is structurally incapable of modifying or deleting an existing entry: it
 * copies `existing` wholesale and then only ever assigns keys that were absent
 * from it. Regenerating against a different lucide version can therefore add
 * names, and can do nothing else — which is what makes a diagram filmed months
 * ago safe. Removing an entry by hand is permitted and is the one change that
 * can alter an already-filmed diagram.
 *
 * The accepted cost: upstream improvements to icons we already carry are
 * forgone, and a rename leaves a near-duplicate in the picker.
 */
export function appendIcons(
  existing: Readonly<IconTable>,
  incoming: Readonly<IconTable>,
  opts?: { only?: readonly string[] }
): { table: IconTable; added: string[] } {
  const only = opts?.only ? new Set(opts.only) : null;
  const table: IconTable = { ...existing };
  const added: string[] = [];

  for (const name of Object.keys(incoming).sort()) {
    if (only && !only.has(name)) continue;
    if (Object.prototype.hasOwnProperty.call(existing, name)) continue;
    table[name] = incoming[name]!;
    added.push(name);
  }

  return { table, added };
}

/** Serialise a table with sorted keys, so a regeneration diff is append-only too. */
export function serialiseIconTable(table: Readonly<IconTable>): string {
  const sorted: IconTable = {};
  for (const name of Object.keys(table).sort()) sorted[name] = table[name]!;
  return JSON.stringify(sorted);
}

/**
 * The 19 names lucide removed permanently: the 18 brand marks (dropped citing
 * "increasing legal pressures", with `BRAND_LOGOS_STATEMENT.md` saying they
 * will not return) plus `fingerprint`, which was renamed with no alias left
 * behind. Backfilled from 0.525.0 so the frozen set is the *best* geometry
 * rather than merely the newest.
 */
export const BACKFILL_NAMES = [
  "chromium",
  "codepen",
  "codesandbox",
  "dribbble",
  "facebook",
  "figma",
  "framer",
  "fingerprint",
  "github",
  "gitlab",
  "instagram",
  "linkedin",
  "pocket",
  "rail-symbol",
  "slack",
  "trello",
  "twitch",
  "twitter",
  "youtube",
] as const;
