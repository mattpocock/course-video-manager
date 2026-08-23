import { describe, it, expect } from "vitest";
import { searchIconNames } from "../index";

describe("searchIconNames", () => {
  // What each hit MATCHES is covered by `icon-table.test.ts`; this file is about
  // the order they come back in.
  it("prefix-matches before substring-matches", () => {
    const names = searchIconNames("circle", { limit: 200, recent: [] });
    // `loader-circle` only CONTAINS the query, so every `circle…` name wins.
    expect(names.indexOf("circle")).toBeLessThan(
      names.indexOf("loader-circle")
    );
  });

  it("leads with a name typed out in full", () => {
    // `circle-x`, `square-x` and friends all match "x" as a whole word, and the
    // table reaches them first. Enter fires on the first cell, so the name the
    // author actually finished typing has to be the one sitting there.
    expect(searchIconNames("x", { limit: 20, recent: [] })[0]).toBe("x");
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

  it("yields to one of lucide's aliases typed out in full", () => {
    // "columns" is lucide's own alias for `columns-2`, so typing it in full is
    // as exact as typing the name — history must not displace it either.
    const names = searchIconNames("columns", {
      limit: 50,
      recent: ["columns-3"],
    });
    expect(names[0]).toBe("columns-2");
    expect(names[1]).toBe("columns-3");
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

  it("lists a repeated recent name exactly once", () => {
    // Nothing stops a hand-edited stored list from repeating a name.
    const names = searchIconNames("", {
      limit: 20,
      recent: ["circle", "atom", "circle"],
    });
    expect(names.filter((n) => n === "circle")).toEqual(["circle"]);
    expect(names.slice(0, 2)).toEqual(["circle", "atom"]);
  });

  it("ignores names the frozen table has never heard of", () => {
    // A stored MRU list outlives the table it was written against.
    const names = searchIconNames("", { limit: 5, recent: ["not-an-icon"] });
    expect(names).not.toContain("not-an-icon");
    expect(names).toHaveLength(5);
  });

  it("does not let a stale name cost a real one its place", () => {
    const names = searchIconNames("", {
      limit: 20,
      recent: ["not-an-icon", "circle"],
    });
    expect(names[0]).toBe("circle");
  });

  it("survives a recent icon that sorts past the result cap", () => {
    // The cap is about mount cost, so it must not be allowed to swallow the one
    // ordering the author explicitly earned.
    const many = searchIconNames("a", { limit: 400, recent: [] });
    const last = many[many.length - 1]!;
    expect(many.length).toBeGreaterThan(50);
    const capped = searchIconNames("a", { limit: 20, recent: [last] });
    expect(capped[0]).toBe(last);
  });

  it("honours the cap when the history alone overflows it", () => {
    const recent = searchIconNames("", { limit: 12, recent: [] });
    const names = searchIconNames("", { limit: 5, recent });
    expect(names).toEqual(recent.slice(0, 5));
  });
});
