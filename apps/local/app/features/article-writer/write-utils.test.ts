import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  LEGACY_DOCUMENT_PURGE_KEY,
  getMessagesStorageKey,
  purgeLegacyDocumentStorage,
  saveMessagesToStorage,
} from "./write-utils";

function createMockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  } satisfies Storage;
}

describe("purgeLegacyDocumentStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes documents written by the retired persistence, keeping messages", () => {
    localStorage.setItem("article-writer-document-v1-article", "# Stale");
    localStorage.setItem(
      "writer-field-document-v1-ai-hero-body-article",
      "# Also stale"
    );
    saveMessagesToStorage("v1", "article", []);

    purgeLegacyDocumentStorage();

    expect(localStorage.getItem("article-writer-document-v1-article")).toBe(
      null
    );
    expect(
      localStorage.getItem("writer-field-document-v1-ai-hero-body-article")
    ).toBe(null);
    expect(localStorage.getItem(getMessagesStorageKey("v1", "article"))).toBe(
      "[]"
    );
  });

  it("does not run a second time", () => {
    purgeLegacyDocumentStorage();
    localStorage.setItem("article-writer-document-v1-article", "# Later");

    purgeLegacyDocumentStorage();

    expect(localStorage.getItem("article-writer-document-v1-article")).toBe(
      "# Later"
    );
    expect(localStorage.getItem(LEGACY_DOCUMENT_PURGE_KEY)).toBe("1");
  });
});
