import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  RECENT_ICONS_LIMIT,
  readRecentIcons,
  recordIconUse,
} from "./recent-icons";

/**
 * `localStorage` is a system boundary, so it is the one thing here worth
 * faking — everything else runs for real, through the module's two functions.
 * `store` doubles as the "another window wrote this" seam.
 */
const KEY = "diagram-palette:recent-icons";
let store: Map<string, string>;

function installStorage(overrides: Partial<Storage> = {}) {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      ...overrides,
    },
  };
}

beforeEach(() => {
  store = new Map();
  installStorage();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("recordIconUse", () => {
  it("puts the icon just used at the front", () => {
    recordIconUse("square");
    recordIconUse("circle");
    expect(recordIconUse("atom")).toEqual(["atom", "circle", "square"]);
  });

  it("survives to the next read", () => {
    recordIconUse("atom");
    expect(readRecentIcons()).toEqual(["atom"]);
  });

  it("moves a repeat use back to the front rather than duplicating it", () => {
    // A duplicate would spend two of the grid's leading cells on one icon.
    recordIconUse("atom");
    recordIconUse("square");
    recordIconUse("circle");
    expect(recordIconUse("atom")).toEqual(["atom", "circle", "square"]);
  });

  it("drops the least recent once the list is full", () => {
    for (let i = 0; i < RECENT_ICONS_LIMIT; i++) recordIconUse(`i${i}`);
    const next = recordIconUse("atom");
    expect(next).toHaveLength(RECENT_ICONS_LIMIT);
    expect(next[0]).toBe("atom");
    expect(next).not.toContain("i0"); // the oldest, pushed off the end
  });

  it("keeps an entry another window recorded in the meantime", () => {
    // The list is re-read on every record, so two playground windows can both
    // insert without either silently reverting the other's history.
    recordIconUse("atom");
    store.set(KEY, JSON.stringify(["square"]));
    expect(recordIconUse("circle")).toEqual(["circle", "square"]);
  });

  it("still reports the new order when storage refuses the write", () => {
    installStorage({
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(recordIconUse("atom")).toEqual(["atom"]);
  });

  it("does not throw when there is no window at all", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(recordIconUse("atom")).toEqual(["atom"]);
  });
});

describe("readRecentIcons", () => {
  it("treats a missing, unparseable or non-array value as no history", () => {
    // The list is a convenience, so nothing about it may throw on open.
    expect(readRecentIcons()).toEqual([]);
    for (const raw of ["", "{oops", JSON.stringify({ atom: 1 })]) {
      store.set(KEY, raw);
      expect(readRecentIcons()).toEqual([]);
    }
  });

  it("keeps only the strings out of a mixed array", () => {
    store.set(KEY, JSON.stringify(["atom", 7, null, "circle"]));
    expect(readRecentIcons()).toEqual(["atom", "circle"]);
  });

  it("truncates a stored list longer than the cap", () => {
    const overlong = Array.from(
      { length: RECENT_ICONS_LIMIT + 5 },
      (_, i) => `i${i}`
    );
    store.set(KEY, JSON.stringify(overlong));
    expect(readRecentIcons()).toHaveLength(RECENT_ICONS_LIMIT);
  });

  it("returns no history when storage is blocked", () => {
    installStorage({
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(readRecentIcons()).toEqual([]);
  });

  it("never writes anything on a plain read", () => {
    readRecentIcons();
    expect(store.size).toBe(0);
  });
});
