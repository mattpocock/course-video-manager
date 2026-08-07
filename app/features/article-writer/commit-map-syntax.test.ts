import { describe, expect, it } from "vitest";
import {
  findCommitMapsWithBlankLines,
  findCommitsMissingId,
  findCommitsOutsideCommitMap,
  findRepeatedCommitIds,
  findUnclosedCommitMaps,
  parseCommitMaps,
} from "./commit-map-syntax";

const entry = (id: string | null, description = "Start here") =>
  id === null
    ? `  <Commit>${description}</Commit>`
    : `  <Commit id="${id}">${description}</Commit>`;

const map = (...entries: string[]) =>
  `<CommitMap>\n${entries.join("\n")}\n</CommitMap>`;

describe("parseCommitMaps", () => {
  it("reads a map's entries", () => {
    const blocks = parseCommitMaps(
      map(entry("main", "The course start"), entry("add-settings-json"))
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.entries).toEqual([
      {
        id: "main",
        openTag: '<Commit id="main">',
        description: "The course start",
      },
      {
        id: "add-settings-json",
        openTag: '<Commit id="add-settings-json">',
        description: "Start here",
      },
    ]);
  });

  it("keeps markdown in a description as authored", () => {
    const blocks = parseCommitMaps(
      map(entry("grill-me-skill", "Added the `/grill-me` skill"))
    );

    expect(blocks[0]!.entries[0]!.description).toBe(
      "Added the `/grill-me` skill"
    );
  });

  it("does not mistake <CommitMap> for an entry", () => {
    const blocks = parseCommitMaps(map(entry("main")));

    expect(blocks[0]!.entries).toHaveLength(1);
  });

  it("reads every map in a body", () => {
    const blocks = parseCommitMaps(
      `${map(entry("main"))}\n\nSome prose.\n\n${map(entry("analytics-page"))}`
    );

    expect(blocks).toHaveLength(2);
  });

  it("yields no block for an unclosed map", () => {
    expect(parseCommitMaps(`<CommitMap>\n${entry("main")}`)).toEqual([]);
  });
});

describe("findCommitsMissingId", () => {
  it("finds an entry with no id", () => {
    expect(findCommitsMissingId(map(entry(null)))).toEqual(["<Commit>"]);
  });

  it("treats an empty id as missing", () => {
    expect(
      findCommitsMissingId(map('  <Commit id="">Nothing</Commit>'))
    ).toEqual(['<Commit id="">']);
  });

  it("passes a whole map", () => {
    expect(
      findCommitsMissingId(map(entry("main"), entry("run-setup-skill")))
    ).toEqual([]);
  });
});

describe("findRepeatedCommitIds", () => {
  it("finds an id used twice", () => {
    expect(findRepeatedCommitIds(map(entry("main"), entry("main")))).toEqual([
      "main",
    ]);
  });

  it("counts across two maps in one body", () => {
    const text = `${map(entry("main"))}\n\n${map(entry("main"))}`;

    expect(findRepeatedCommitIds(text)).toEqual(["main"]);
  });

  it("passes distinct ids", () => {
    expect(
      findRepeatedCommitIds(map(entry("main"), entry("to-spec-skill")))
    ).toEqual([]);
  });
});

describe("findCommitsOutsideCommitMap", () => {
  it("finds an entry adrift in the body", () => {
    expect(
      findCommitsOutsideCommitMap(`${entry("main")}\n\n${map(entry("main"))}`)
    ).toEqual(['<Commit id="main">']);
  });

  it("passes entries inside a map", () => {
    expect(findCommitsOutsideCommitMap(map(entry("main")))).toEqual([]);
  });

  it("does not also report the entries of an unclosed map", () => {
    // The unclosed block is one violation, reported by its own rule. Counting
    // its entries again would say the same thing three times.
    const text = `<CommitMap>\n${entry("main")}\n${entry("to-spec-skill")}`;

    expect(findCommitsOutsideCommitMap(text)).toEqual([]);
  });
});

describe("findUnclosedCommitMaps", () => {
  it("finds a map that never closes", () => {
    expect(findUnclosedCommitMaps(`<CommitMap>\n${entry("main")}`)).toEqual([
      "<CommitMap>",
    ]);
  });

  it("passes a closed map", () => {
    expect(findUnclosedCommitMaps(map(entry("main")))).toEqual([]);
  });
});

describe("findCommitMapsWithBlankLines", () => {
  it("finds a blank line between entries", () => {
    const text = `<CommitMap>\n${entry("main")}\n\n${entry("to-spec-skill")}\n</CommitMap>`;

    expect(findCommitMapsWithBlankLines(text)).toEqual(["<CommitMap>"]);
  });

  it("finds a blank line after the opening tag", () => {
    const text = `<CommitMap>\n\n${entry("main")}\n</CommitMap>`;

    expect(findCommitMapsWithBlankLines(text)).toEqual(["<CommitMap>"]);
  });

  it("passes a contiguous block", () => {
    expect(
      findCommitMapsWithBlankLines(map(entry("main"), entry("to-spec-skill")))
    ).toEqual([]);
  });
});
