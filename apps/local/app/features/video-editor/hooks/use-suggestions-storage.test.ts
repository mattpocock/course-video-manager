import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPickedFiles, writePickedFiles } from "./use-suggestions";

describe("the repo files picked for Suggestions", () => {
  let entries: Record<string, string>;
  beforeEach(() => {
    entries = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => entries[key] ?? null,
      setItem: (key: string, value: string) => {
        entries[key] = value;
      },
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("are kept per Video: one Video's pick never shows on another", () => {
    writePickedFiles("v1", ["README.md", "src/index.ts"]);
    writePickedFiles("v2", ["notes.md"]);

    expect(readPickedFiles("v1")).toEqual(["README.md", "src/index.ts"]);
    expect(readPickedFiles("v2")).toEqual(["notes.md"]);
    expect(readPickedFiles("v3")).toEqual([]);
  });
});
