import { describe, it, expect } from "vitest";
import {
  appendIcons,
  normaliseIconNode,
  parseIconModule,
  parseIconModules,
  serialiseIconTable,
  type IconTable,
} from "../generator";

// A stand-in for one lucide-react ESM icon module, in the shape 1.x ships.
function iconModule(d: string): string {
  return [
    "import createLucideIcon from '../createLucideIcon.mjs';",
    "",
    "const __iconNode = [",
    `  ["path", { d: ${JSON.stringify(d)}, key: "abc123" }]`,
    "];",
    'const Thing = createLucideIcon("thing", __iconNode);',
    "",
    "export { __iconNode, Thing as default };",
    "",
  ].join("\n");
}

function aliasModule(target: string): string {
  return `export { default } from './${target}.mjs';\n`;
}

describe("parseIconModule", () => {
  it("extracts the raw icon node and strips React keys", () => {
    const parsed = parseIconModule(iconModule("M1 2h3"));
    expect(parsed).toEqual({
      kind: "icon",
      node: [["path", { d: "M1 2h3" }]],
    });
  });

  it("recognises an alias module and reports its target", () => {
    expect(parseIconModule(aliasModule("hand-grab"))).toEqual({
      kind: "alias",
      target: "hand-grab",
    });
  });

  it("returns null for a module that is neither", () => {
    expect(
      parseIconModule("export { default as A } from './a.mjs';")
    ).toBeNull();
  });
});

describe("parseIconModules", () => {
  it("separates icons, aliases and anything it could not read", () => {
    const parsed = parseIconModules(
      new Map([
        ["hand-grab", iconModule("M1 1h1")],
        ["grab", aliasModule("hand-grab")],
        ["mystery", "// nothing here"],
      ])
    );
    expect(Object.keys(parsed.icons)).toEqual(["hand-grab"]);
    expect(parsed.synonyms).toEqual({ grab: "hand-grab" });
    expect(parsed.unparsed).toEqual(["mystery"]);
  });
});

describe("normaliseIconNode", () => {
  it("leaves every non-key attribute exactly as lucide wrote it", () => {
    expect(
      normaliseIconNode([
        ["rect", { x: 3, y: 3, width: 18, height: 18, ry: 2, key: "z" }],
      ])
    ).toEqual([["rect", { x: 3, y: 3, width: 18, height: 18, ry: 2 }]]);
  });
});

describe("appendIcons — the append-only invariant", () => {
  const existing: IconTable = {
    circle: [["circle", { cx: 12, cy: 12, r: 10 }]],
    hammer: [["path", { d: "M1 1" }]],
  };

  it("adds names it has never seen", () => {
    const incoming: IconTable = { star: [["path", { d: "M5 5" }]] };
    const { table, added } = appendIcons(existing, incoming);
    expect(added).toEqual(["star"]);
    expect(table.star).toEqual(incoming.star);
  });

  it("leaves every existing entry byte-identical when a later lucide moved it", () => {
    // This is the whole point: lucide moved 41 icons' geometry under an
    // unchanged name inside 1.x alone. A regeneration must not follow.
    const incoming: IconTable = {
      hammer: [["path", { d: "M99 99 — upstream moved this" }]],
      circle: [["circle", { cx: 12, cy: 12, r: 9 }]],
      newcomer: [["line", { x1: 0, y1: 0, x2: 1, y2: 1 }]],
    };
    const before = serialiseIconTable(existing);
    const { table, added } = appendIcons(existing, incoming);

    expect(added).toEqual(["newcomer"]);
    expect(table.hammer).toEqual(existing.hammer);
    expect(table.circle).toEqual(existing.circle);
    expect(serialiseIconTable(existing)).toBe(before); // input untouched
  });

  it("cannot delete: a name missing from the newer lucide survives", () => {
    const { table } = appendIcons(existing, {
      star: [["path", { d: "M5 5" }]],
    });
    expect(table.hammer).toEqual(existing.hammer);
    expect(table.circle).toEqual(existing.circle);
  });

  it("honours an explicit `only` list, for backfilling removed names", () => {
    const incoming: IconTable = {
      github: [["path", { d: "M9 19" }]],
      "some-other-icon": [["path", { d: "M1 1" }]],
    };
    const { table, added } = appendIcons(existing, incoming, {
      only: ["github"],
    });
    expect(added).toEqual(["github"]);
    expect(table["some-other-icon"]).toBeUndefined();
  });
});

describe("serialiseIconTable", () => {
  it("sorts keys, so a regeneration diff is itself append-only", () => {
    const json = serialiseIconTable({
      zebra: [["path", { d: "M1 1" }]],
      apple: [["path", { d: "M2 2" }]],
    });
    expect(json.indexOf('"apple"')).toBeLessThan(json.indexOf('"zebra"'));
  });
});
