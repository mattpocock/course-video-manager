import { describe, it, expect } from "vitest";
import { searchIconNames } from "../index";

describe("searchIconNames", () => {
  // What each hit MATCHES is covered by `icon-table.test.ts`; this file is about
  // the order they come back in.
  it("prefix-matches before substring-matches", () => {
    const names = searchIconNames("circle", { limit: 200 });
    // `loader-circle` only CONTAINS the query, so every `circle…` name wins.
    expect(names.indexOf("circle")).toBeLessThan(
      names.indexOf("loader-circle")
    );
  });
});

describe("recently used icons", () => {
  it("sorts them to the top of an unfiltered list", () => {
    const recent = ["train-track", "circle"];
    const names = searchIconNames("", { limit: 20, recent });
    expect(names.slice(0, 2)).toEqual(recent);
  });

  it("keeps them in recency order, most recent first", () => {
    const names = searchIconNames("", {
      limit: 20,
      recent: ["circle", "atom"],
    });
    expect(names.slice(0, 2)).toEqual(["circle", "atom"]);
  });

  it("lifts a recent icon above a better textual match", () => {
    // `square` is a prefix match for the query while `key-square` merely
    // contains it, so without recency `key-square` would sort below every
    // prefix match instead of first.
    const names = searchIconNames("squar", {
      limit: 50,
      recent: ["key-square"],
    });
    expect(names[0]).toBe("key-square");
    expect(names[1]).toBe("square");
  });

  it("yields to a name typed out in full", () => {
    // Enter fires on the first cell, so history must not steal a query the
    // author has already spelled exactly — that inserts the wrong icon.
    const names = searchIconNames("square", {
      limit: 50,
      recent: ["key-square"],
    });
    expect(names[0]).toBe("square");
    expect(names[1]).toBe("key-square");
  });

  it("never shows a recent icon that does not match the query", () => {
    const names = searchIconNames("triangle", {
      limit: 50,
      recent: ["circle"],
    });
    expect(names).not.toContain("circle");
  });

  it("lists a recent icon exactly once", () => {
    const names = searchIconNames("circle", { limit: 50, recent: ["circle"] });
    expect(names.filter((n) => n === "circle")).toEqual(["circle"]);
  });

  it("ignores names the frozen table has never heard of", () => {
    // A stored MRU list outlives the table it was written against.
    const names = searchIconNames("", { limit: 5, recent: ["not-an-icon"] });
    expect(names).not.toContain("not-an-icon");
    expect(names).toHaveLength(5);
  });

  it("survives a recent icon that sorts past the result cap", () => {
    // The cap is about mount cost, so it must not be allowed to swallow the one
    // ordering the author explicitly earned.
    const many = searchIconNames("a", { limit: 400 });
    const last = many[many.length - 1]!;
    expect(many.length).toBeGreaterThan(50);
    const capped = searchIconNames("a", { limit: 20, recent: [last] });
    expect(capped[0]).toBe(last);
  });
});
