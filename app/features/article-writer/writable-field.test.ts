import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadFieldMessages,
  saveFieldMessages,
  loadFieldDocument,
  saveFieldDocument,
  FIELD_MODES,
  constrainModes,
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

describe("WritableField Apply/Cancel semantics", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Cancel restores conversation snapshot", () => {
    it("restores messages to their pre-open state on cancel", () => {
      const videoId = "v1";
      const fieldId = "ai-hero-body" as const;
      const mode = "article" as const;
      const originalMessages = [{ role: "user", content: "original" }];

      saveFieldMessages(videoId, fieldId, mode, originalMessages);

      const snapshot = new Map<string, unknown[]>();
      for (const m of FIELD_MODES[fieldId]) {
        snapshot.set(m, loadFieldMessages(videoId, fieldId, m));
      }

      const newMessages = [
        { role: "user", content: "original" },
        { role: "assistant", content: "new response" },
      ];
      saveFieldMessages(videoId, fieldId, mode, newMessages);

      expect(loadFieldMessages(videoId, fieldId, mode)).toEqual(newMessages);

      for (const [m, msgs] of snapshot) {
        saveFieldMessages(videoId, fieldId, m as typeof mode, msgs);
      }

      expect(loadFieldMessages(videoId, fieldId, mode)).toEqual(
        originalMessages
      );
    });

    it("restores messages across all modes on cancel", () => {
      const videoId = "v1";
      const fieldId = "ai-hero-body" as const;

      saveFieldMessages(videoId, fieldId, "article", [{ id: "article-msg" }]);
      saveFieldMessages(videoId, fieldId, "article-plan", [{ id: "plan-msg" }]);

      const snapshot = new Map<string, unknown[]>();
      for (const m of FIELD_MODES[fieldId]) {
        snapshot.set(m, loadFieldMessages(videoId, fieldId, m));
      }

      saveFieldMessages(videoId, fieldId, "article", [
        { id: "article-msg" },
        { id: "article-msg-2" },
      ]);
      saveFieldMessages(videoId, fieldId, "article-plan", []);

      for (const [m, msgs] of snapshot) {
        saveFieldMessages(
          videoId,
          fieldId,
          m as (typeof FIELD_MODES)[typeof fieldId][number],
          msgs
        );
      }

      expect(loadFieldMessages(videoId, fieldId, "article")).toEqual([
        { id: "article-msg" },
      ]);
      expect(loadFieldMessages(videoId, fieldId, "article-plan")).toEqual([
        { id: "plan-msg" },
      ]);
    });
  });

  describe("Apply uses working document value", () => {
    it("document value persisted during session is available for apply", () => {
      const videoId = "v1";
      const fieldId = "ai-hero-body" as const;
      const mode = "article" as const;

      saveFieldDocument(videoId, fieldId, mode, "# Draft article");

      const workingValue = loadFieldDocument(videoId, fieldId, mode);
      expect(workingValue).toBe("# Draft article");
    });

    it("apply does not revert messages (only cancel does)", () => {
      const videoId = "v1";
      const fieldId = "skills-changelog-body" as const;
      const mode = "skill-building" as const;

      saveFieldMessages(videoId, fieldId, mode, [{ id: "msg-1" }]);

      const snapshot = new Map<string, unknown[]>();
      for (const m of FIELD_MODES[fieldId]) {
        snapshot.set(m, loadFieldMessages(videoId, fieldId, m));
      }

      saveFieldMessages(videoId, fieldId, mode, [
        { id: "msg-1" },
        { id: "msg-2" },
      ]);

      expect(loadFieldMessages(videoId, fieldId, mode)).toEqual([
        { id: "msg-1" },
        { id: "msg-2" },
      ]);
    });
  });
});

describe("WritableField keying isolation", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("different fieldIds on the same video have independent conversations", () => {
    saveFieldMessages("v1", "ai-hero-body", "article", [{ id: "a" }]);
    saveFieldMessages("v1", "skills-changelog-body", "article", [{ id: "b" }]);
    saveFieldMessages("v1", "newsletter-copy", "newsletter", [{ id: "c" }]);

    expect(loadFieldMessages("v1", "ai-hero-body", "article")).toEqual([
      { id: "a" },
    ]);
    expect(loadFieldMessages("v1", "skills-changelog-body", "article")).toEqual(
      [{ id: "b" }]
    );
    expect(loadFieldMessages("v1", "newsletter-copy", "newsletter")).toEqual([
      { id: "c" },
    ]);
  });

  it("same field on different videos has independent conversations", () => {
    saveFieldMessages("v1", "ai-hero-body", "article", [{ id: "v1-msg" }]);
    saveFieldMessages("v2", "ai-hero-body", "article", [{ id: "v2-msg" }]);

    expect(loadFieldMessages("v1", "ai-hero-body", "article")).toEqual([
      { id: "v1-msg" },
    ]);
    expect(loadFieldMessages("v2", "ai-hero-body", "article")).toEqual([
      { id: "v2-msg" },
    ]);
  });

  it("same field+video with different modes has independent conversations", () => {
    saveFieldMessages("v1", "ai-hero-body", "article", [{ id: "article-msg" }]);
    saveFieldMessages("v1", "ai-hero-body", "article-plan", [
      { id: "plan-msg" },
    ]);

    expect(loadFieldMessages("v1", "ai-hero-body", "article")).toEqual([
      { id: "article-msg" },
    ]);
    expect(loadFieldMessages("v1", "ai-hero-body", "article-plan")).toEqual([
      { id: "plan-msg" },
    ]);
  });

  it("documents are keyed independently from messages", () => {
    saveFieldMessages("v1", "ai-hero-body", "article", [{ id: "msg" }]);
    saveFieldDocument("v1", "ai-hero-body", "article", "# Document");

    expect(loadFieldMessages("v1", "ai-hero-body", "article")).toEqual([
      { id: "msg" },
    ]);
    expect(loadFieldDocument("v1", "ai-hero-body", "article")).toBe(
      "# Document"
    );
  });
});

describe("WritableField constrained modes", () => {
  it("ai-hero-body constrains to article and article-plan modes", () => {
    const modes = FIELD_MODES["ai-hero-body"];
    expect(modes).toContain("article");
    expect(modes).toContain("article-plan");
    expect(modes).not.toContain("newsletter");
  });

  it("newsletter-copy constrains to newsletter mode only", () => {
    const modes = FIELD_MODES["newsletter-copy"];
    expect(modes).toContain("newsletter");
    expect(modes).not.toContain("article");
    expect(modes).not.toContain("skill-building");
  });

  it("skills-changelog-body constrains to article and article-plan modes", () => {
    const modes = FIELD_MODES["skills-changelog-body"];
    expect(modes).toContain("article");
    expect(modes).toContain("article-plan");
    expect(modes).not.toContain("newsletter");
  });

  it("constrainModes falls back to first allowed mode for field", () => {
    const result = constrainModes(FIELD_MODES["newsletter-copy"], "article");
    expect(result.mode).toBe("newsletter");
    expect(result.isConstrained).toBe(true);
  });

  it("constrainModes keeps mode if already in allowed list", () => {
    const result = constrainModes(FIELD_MODES["ai-hero-body"], "article");
    expect(result.mode).toBe("article");
    expect(result.isConstrained).toBe(true);
  });

  it("constrainModes is unconstrained with empty modes list", () => {
    const result = constrainModes([], "newsletter");
    expect(result.mode).toBe("newsletter");
    expect(result.isConstrained).toBe(false);
  });
});
