import { describe, expect, it } from "vitest";
import { parseStringSet } from "./use-local-storage";

describe("parseStringSet", () => {
  it("reads back a stored id list", () => {
    expect(parseStringSet('["link-1","link-2"]')).toEqual(
      new Set(["link-1", "link-2"])
    );
  });

  it("reads an empty list as an empty set", () => {
    expect(parseStringSet("[]")).toEqual(new Set());
  });

  it("falls back to an empty set on unparseable JSON", () => {
    expect(parseStringSet("not json")).toEqual(new Set());
  });

  it("falls back to an empty set when the value is not an array", () => {
    expect(parseStringSet('{"link-1":true}')).toEqual(new Set());
  });

  it("drops non-string members rather than the whole list", () => {
    expect(parseStringSet('["link-1",7,null,"link-2"]')).toEqual(
      new Set(["link-1", "link-2"])
    );
  });
});
