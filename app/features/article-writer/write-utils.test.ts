import { describe, it, expect } from "vitest";
import {
  COURSE_STRUCTURE_STORAGE_KEY,
  MEMORY_ENABLED_STORAGE_KEY,
  BEATS_ENABLED_STORAGE_KEY,
} from "./write-utils";

describe("context toggle storage keys", () => {
  it("exports a storage key for every atomic context toggle", () => {
    expect(COURSE_STRUCTURE_STORAGE_KEY).toBeTypeOf("string");
    expect(MEMORY_ENABLED_STORAGE_KEY).toBeTypeOf("string");
    expect(BEATS_ENABLED_STORAGE_KEY).toBeTypeOf("string");
  });

  it("uses distinct keys for each toggle", () => {
    const keys = new Set([
      COURSE_STRUCTURE_STORAGE_KEY,
      MEMORY_ENABLED_STORAGE_KEY,
      BEATS_ENABLED_STORAGE_KEY,
    ]);
    expect(keys.size).toBe(3);
  });
});
