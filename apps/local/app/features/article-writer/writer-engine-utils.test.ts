import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getFieldMessagesStorageKey,
  loadFieldMessages,
  saveFieldMessages,
  constrainModes,
  defaultModeForRole,
  documentToApply,
  FIELD_MODES,
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
    key: (index: number) => [...store.keys()][index] ?? null,
  } satisfies Storage;
}

describe("conversation keying by (videoId, fieldId, mode)", () => {
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

  it("stores nothing but conversations", () => {
    saveFieldMessages("v1", "ai-hero-body", "article", [{ id: "msg" }]);

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i)!);
    }
    expect(keys).toEqual(["writer-field-messages-v1-ai-hero-body-article"]);
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
  it("only includes document modes", () => {
    const documentModes = [
      "article",
      "article-plan",
      "newsletter",
      "problem",
      "explainer",
      "solution",
      "seo-description-document",
    ];
    for (const fieldModes of Object.values(FIELD_MODES)) {
      for (const mode of fieldModes) {
        expect(documentModes).toContain(mode);
      }
    }
  });
});

describe("defaultModeForRole", () => {
  it("opens each lesson role on its own mode", () => {
    expect(defaultModeForRole("problem")).toBe("problem");
    expect(defaultModeForRole("explainer")).toBe("explainer");
    expect(defaultModeForRole("solution")).toBe("solution");
  });

  it("opens a standalone video on article", () => {
    expect(defaultModeForRole("unknown")).toBe("article");
    expect(defaultModeForRole(undefined)).toBe("article");
  });

  it("lands each role on its own mode in the lesson body modes", () => {
    for (const role of ["problem", "explainer", "solution"] as const) {
      expect(
        constrainModes(FIELD_MODES["video-body"], defaultModeForRole(role)).mode
      ).toBe(role);
    }
  });

  it("falls back to the field's first mode when the role's mode isn't offered", () => {
    expect(
      constrainModes(["article", "article-plan"], defaultModeForRole("problem"))
        .mode
    ).toBe("article");
  });
});

describe("conversations saved under the retired modes", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a skill-building conversation as the problem one", () => {
    localStorage.setItem(
      "writer-field-messages-v1-video-body-skill-building",
      JSON.stringify([{ id: "old" }])
    );
    expect(loadFieldMessages("v1", "video-body", "problem")).toEqual([
      { id: "old" },
    ]);
  });

  it("reads an article conversation as the explainer and solution ones", () => {
    localStorage.setItem(
      "writer-field-messages-v1-video-body-article",
      JSON.stringify([{ id: "old" }])
    );
    expect(loadFieldMessages("v1", "video-body", "explainer")).toEqual([
      { id: "old" },
    ]);
    expect(loadFieldMessages("v1", "video-body", "solution")).toEqual([
      { id: "old" },
    ]);
  });

  it("prefers the conversation saved under the new mode", () => {
    localStorage.setItem(
      "writer-field-messages-v1-video-body-article",
      JSON.stringify([{ id: "old" }])
    );
    saveFieldMessages("v1", "video-body", "solution", [{ id: "new" }]);
    expect(loadFieldMessages("v1", "video-body", "solution")).toEqual([
      { id: "new" },
    ]);
  });
});

describe("documentToApply", () => {
  const withQuiz = `Intro.

<Quiz>
  <QuizQuestion data={{ id: "a", question: "Q?", type: "multiple-choice", choices: [{ answer: "a", label: "A" }], correct: "a", answer: "Because." }} />
</Quiz>
`;

  it("never lets a quiz through in solution mode", () => {
    expect(documentToApply("solution", withQuiz)).not.toContain("<Quiz");
  });

  it("leaves an explainer's quiz alone", () => {
    expect(documentToApply("explainer", withQuiz)).toBe(withQuiz);
  });
});
