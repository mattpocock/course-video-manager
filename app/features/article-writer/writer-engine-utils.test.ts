import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getFieldMessagesStorageKey,
  getFieldDocumentStorageKey,
  loadFieldMessages,
  saveFieldMessages,
  loadFieldDocument,
  saveFieldDocument,
  constrainModes,
  FIELD_MODES,
  FIELD_LABELS,
} from "./writer-engine-utils";

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
    key: (_index: number) => null,
  } satisfies Storage;
}

describe("conversation keying by (videoId, fieldId, mode)", () => {
  it("generates distinct message keys for different fields on the same video", () => {
    const k1 = getFieldMessagesStorageKey("v1", "ai-hero-body", "article");
    const k2 = getFieldMessagesStorageKey(
      "v1",
      "skills-changelog-body",
      "article"
    );
    expect(k1).not.toBe(k2);
  });

  it("generates distinct message keys for different modes on the same field", () => {
    const k1 = getFieldMessagesStorageKey("v1", "ai-hero-body", "article");
    const k2 = getFieldMessagesStorageKey("v1", "ai-hero-body", "article-plan");
    expect(k1).not.toBe(k2);
  });

  it("generates distinct message keys for different videos on the same field", () => {
    const k1 = getFieldMessagesStorageKey("v1", "ai-hero-body", "article");
    const k2 = getFieldMessagesStorageKey("v2", "ai-hero-body", "article");
    expect(k1).not.toBe(k2);
  });

  it("generates distinct document keys for different fields", () => {
    const k1 = getFieldDocumentStorageKey("v1", "ai-hero-body", "article");
    const k2 = getFieldDocumentStorageKey(
      "v1",
      "newsletter-copy",
      "newsletter"
    );
    expect(k1).not.toBe(k2);
  });

  it("message and document keys for the same triple are different", () => {
    const mk = getFieldMessagesStorageKey("v1", "ai-hero-body", "article");
    const dk = getFieldDocumentStorageKey("v1", "ai-hero-body", "article");
    expect(mk).not.toBe(dk);
  });
});

describe("field messages localStorage persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads empty array when nothing stored", () => {
    const msgs = loadFieldMessages("v1", "ai-hero-body", "article");
    expect(msgs).toEqual([]);
  });

  it("round-trips messages through save and load", () => {
    const messages = [{ role: "user", text: "hello" }];
    saveFieldMessages("v1", "ai-hero-body", "article", messages);
    const loaded = loadFieldMessages("v1", "ai-hero-body", "article");
    expect(loaded).toEqual(messages);
  });

  it("does not bleed between fields", () => {
    saveFieldMessages("v1", "ai-hero-body", "article", [{ id: 1 }]);
    saveFieldMessages("v1", "skills-changelog-body", "article", [{ id: 2 }]);
    expect(loadFieldMessages("v1", "ai-hero-body", "article")).toEqual([
      { id: 1 },
    ]);
    expect(loadFieldMessages("v1", "skills-changelog-body", "article")).toEqual(
      [{ id: 2 }]
    );
  });
});

describe("field document localStorage persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads undefined when nothing stored", () => {
    expect(loadFieldDocument("v1", "ai-hero-body", "article")).toBeUndefined();
  });

  it("round-trips document content", () => {
    saveFieldDocument("v1", "ai-hero-body", "article", "# Hello");
    expect(loadFieldDocument("v1", "ai-hero-body", "article")).toBe("# Hello");
  });

  it("removes document when saved as undefined", () => {
    saveFieldDocument("v1", "ai-hero-body", "article", "# Hello");
    saveFieldDocument("v1", "ai-hero-body", "article", undefined);
    expect(loadFieldDocument("v1", "ai-hero-body", "article")).toBeUndefined();
  });
});

describe("constrainModes", () => {
  it("returns the current mode if it is in the allowed list", () => {
    const result = constrainModes(["article", "article-plan"], "article");
    expect(result).toEqual({ mode: "article", isConstrained: true });
  });

  it("falls back to the first allowed mode if current is not allowed", () => {
    const result = constrainModes(["article", "article-plan"], "newsletter");
    expect(result).toEqual({ mode: "article", isConstrained: true });
  });

  it("returns current mode unconstrained when modes list is empty", () => {
    const result = constrainModes([], "newsletter");
    expect(result).toEqual({ mode: "newsletter", isConstrained: false });
  });
});

describe("FIELD_MODES", () => {
  it("has modes defined for each field", () => {
    expect(FIELD_MODES["ai-hero-body"].length).toBeGreaterThan(0);
    expect(FIELD_MODES["skills-changelog-body"].length).toBeGreaterThan(0);
    expect(FIELD_MODES["newsletter-copy"].length).toBeGreaterThan(0);
    expect(FIELD_MODES["video-body"].length).toBeGreaterThan(0);
  });

  it("only includes document modes", () => {
    const documentModes = [
      "article",
      "article-plan",
      "newsletter",
      "skill-building",
      "seo-description-document",
    ];
    for (const fieldModes of Object.values(FIELD_MODES)) {
      for (const mode of fieldModes) {
        expect(documentModes).toContain(mode);
      }
    }
  });
});

describe("FIELD_LABELS", () => {
  it("has labels for all fields", () => {
    expect(FIELD_LABELS["ai-hero-body"]).toBe("AI Hero Body");
    expect(FIELD_LABELS["skills-changelog-body"]).toBe("Skills Changelog Body");
    expect(FIELD_LABELS["newsletter-copy"]).toBe("Newsletter Copy");
    expect(FIELD_LABELS["video-body"]).toBe("Lesson Body");
  });
});
