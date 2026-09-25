import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  parseStringSet,
  useLocalStorage,
  valueForKey,
} from "./use-local-storage";

/**
 * Installs a `localStorage` global for the length of one test. `undefined`
 * entries install the broken stub — the global present, `getItem` missing —
 * which is what SSR actually meets.
 */
function withStorage(
  entries: Record<string, string> | undefined,
  run: () => void
): void {
  const had = "localStorage" in globalThis;
  const previous = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage =
    entries === undefined
      ? {}
      : {
          getItem: (key: string) => entries[key] ?? null,
          setItem: (key: string, value: string) => {
            entries[key] = value;
          },
        };
  try {
    run();
  } finally {
    if (had) (globalThis as { localStorage?: unknown }).localStorage = previous;
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

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

describe("valueForKey", () => {
  it("keeps an unsaved edit while the key stays the same", () => {
    const held = { key: "draft-a", value: "half a sentence" };
    expect(valueForKey(held, "draft-a", "")).toBe(held);
  });

  it("reads the new key's own value when the key changes", () => {
    withStorage({ "draft-b": "the other draft" }, () => {
      const held = { key: "draft-a", value: "half a sentence" };
      expect(valueForKey(held, "draft-b", "")).toEqual({
        key: "draft-b",
        value: "the other draft",
      });
    });
  });

  it("falls back when the new key holds nothing, rather than carrying the old value over", () => {
    withStorage({}, () => {
      const held = { key: "draft-a", value: "half a sentence" };
      expect(valueForKey(held, "draft-b", "")).toEqual({
        key: "draft-b",
        value: "",
      });
    });
  });
});

describe("the SSR guard", () => {
  it("renders the fallback when localStorage is a stub whose methods are missing", () => {
    // Node's own Web Storage stub, as SSR meets it: the global exists, its
    // methods do not.
    withStorage(undefined, () => {
      function Probe() {
        const [value] = useLocalStorage("draft-a", "nothing stored");
        return createElement("p", null, value);
      }
      expect(renderToStaticMarkup(createElement(Probe))).toBe(
        "<p>nothing stored</p>"
      );
    });
  });
});
