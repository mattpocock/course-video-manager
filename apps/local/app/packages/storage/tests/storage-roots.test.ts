import { describe, expect, it } from "vitest";
import {
  InvalidStorageRootsError,
  isImportedFootage,
  parseStorageRoots,
  rootLabel,
  rootRelativePath,
  toRootRelative,
} from "../index";

describe("parseStorageRoots", () => {
  it("reads an ordered, comma-separated list, dropping trailing slashes", () => {
    expect(parseStorageRoots(" /mnt/d/, /mnt/e ")).toEqual([
      "/mnt/d",
      "/mnt/e",
    ]);
  });

  it.each([
    ["", "empty"],
    ["mnt/d", "relative"],
    ["/", "the filesystem root"],
    ["/mnt/d,/mnt/d", "listed twice"],
    ["/mnt/d,/mnt/d/raw-footage", "nested"],
  ])("refuses %j (%s)", (raw) => {
    expect(() => parseStorageRoots(raw)).toThrow(InvalidStorageRootsError);
  });
});

describe("rootRelativePath", () => {
  const roots = ["/mnt/d", "/mnt/e"];

  it("strips the root from a legacy absolute path under it", () => {
    expect(rootRelativePath("/mnt/e/raw-footage/a.mkv", roots)).toBe(
      "raw-footage/a.mkv"
    );
  });

  it("keeps a relative path as it is", () => {
    expect(rootRelativePath("raw-footage/a.mkv", roots)).toBe(
      "raw-footage/a.mkv"
    );
  });

  it("is null for an absolute path under no root, which toRootRelative keeps", () => {
    expect(rootRelativePath("/home/matt/Videos/s/mic.mkv", roots)).toBeNull();
    expect(rootRelativePath("/mnt/dd/a.mkv", roots)).toBeNull();
    expect(toRootRelative("/mnt/dd/a.mkv", roots)).toBe("/mnt/dd/a.mkv");
  });
});

describe("rootLabel", () => {
  it("names a WSL drive mount by its drive letter", () => {
    expect(rootLabel("/mnt/e")).toBe("E:");
    expect(rootLabel("/srv/footage")).toBe("/srv/footage");
  });
});

describe("isImportedFootage", () => {
  it("is any root-relative path under raw-footage/imported/, nested folders included", () => {
    expect(isImportedFootage("raw-footage/imported/interview.mp4")).toBe(true);
    expect(isImportedFootage("raw-footage/imported/streamyard/guest.mp4")).toBe(
      true
    );
    expect(isImportedFootage("./raw-footage//imported/b-roll.mp4")).toBe(true);
    expect(isImportedFootage("raw-footage/take.mkv")).toBe(false);
    expect(isImportedFootage("raw-footage/imported")).toBe(false);
    expect(isImportedFootage("raw-footage/imported-old/x.mp4")).toBe(false);
    expect(isImportedFootage("raw-footage/imported/../take.mkv")).toBe(false);
    expect(isImportedFootage("/mnt/d/raw-footage/imported/x.mp4")).toBe(false);
  });
});
