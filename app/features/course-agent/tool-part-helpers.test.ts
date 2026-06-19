import { describe, it, expect } from "vitest";
import { stringifyToolOutput } from "./tool-part-helpers";

describe("stringifyToolOutput", () => {
  it("returns a string value as-is", () => {
    expect(stringifyToolOutput("hello world")).toBe("hello world");
  });

  it("serializes a plain object to indented JSON", () => {
    const obj = { files: ["a.ts", "b.ts"] };
    expect(stringifyToolOutput(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  it("serializes an array to indented JSON", () => {
    const arr = [1, 2, 3];
    expect(stringifyToolOutput(arr)).toBe(JSON.stringify(arr, null, 2));
  });

  it("converts a number to its string representation", () => {
    expect(stringifyToolOutput(42)).toBe("42");
  });

  it("converts a boolean to its string representation", () => {
    expect(stringifyToolOutput(true)).toBe("true");
  });

  it("returns empty string for null", () => {
    expect(stringifyToolOutput(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(stringifyToolOutput(undefined)).toBe("");
  });
});
