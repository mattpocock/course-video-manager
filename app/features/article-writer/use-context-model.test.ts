import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadBooleanFlag,
  saveBooleanFlag,
  MEMORY_ENABLED_STORAGE_KEY,
  COURSE_STRUCTURE_STORAGE_KEY,
} from "./write-utils";

const store = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
  key: (_index: number) => null,
} satisfies Storage;

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", fakeLocalStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadBooleanFlag", () => {
  it("returns false when key is not set", () => {
    expect(loadBooleanFlag(MEMORY_ENABLED_STORAGE_KEY)).toBe(false);
  });

  it('returns true when key is "true"', () => {
    store.set(MEMORY_ENABLED_STORAGE_KEY, "true");
    expect(loadBooleanFlag(MEMORY_ENABLED_STORAGE_KEY)).toBe(true);
  });

  it('returns false when key is "false"', () => {
    store.set(MEMORY_ENABLED_STORAGE_KEY, "false");
    expect(loadBooleanFlag(MEMORY_ENABLED_STORAGE_KEY)).toBe(false);
  });

  it("works for course structure key", () => {
    store.set(COURSE_STRUCTURE_STORAGE_KEY, "true");
    expect(loadBooleanFlag(COURSE_STRUCTURE_STORAGE_KEY)).toBe(true);
  });
});

describe("saveBooleanFlag", () => {
  it("saves true to localStorage", () => {
    saveBooleanFlag(MEMORY_ENABLED_STORAGE_KEY, true);
    expect(store.get(MEMORY_ENABLED_STORAGE_KEY)).toBe("true");
  });

  it("saves false to localStorage", () => {
    saveBooleanFlag(MEMORY_ENABLED_STORAGE_KEY, false);
    expect(store.get(MEMORY_ENABLED_STORAGE_KEY)).toBe("false");
  });

  it("round-trips through loadBooleanFlag", () => {
    saveBooleanFlag(COURSE_STRUCTURE_STORAGE_KEY, true);
    expect(loadBooleanFlag(COURSE_STRUCTURE_STORAGE_KEY)).toBe(true);

    saveBooleanFlag(COURSE_STRUCTURE_STORAGE_KEY, false);
    expect(loadBooleanFlag(COURSE_STRUCTURE_STORAGE_KEY)).toBe(false);
  });
});
