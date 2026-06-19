import { describe, it, expect } from "vitest";
import {
  deriveDiff,
  computeContentHash,
  resolveFileType,
  type DiffInput,
  type DiffMessage,
  type CatStamp,
} from "./derive-diff";
import { vfsCat } from "./vfs-cat";
import {
  buildCtx,
  makeMessages,
  stampCat,
  writeInput,
} from "./derive-diff-test-helpers";

describe("resolveFileType", () => {
  it("resolves manifest file types", () => {
    expect(
      resolveFileType("/courses/my-course/sections/_members.json")
    ).toEqual({ kind: "manifest", entityType: "section" });
    expect(
      resolveFileType(
        "/courses/my-course/sections/01-intro/lessons/_members.json"
      )
    ).toEqual({ kind: "manifest", entityType: "lesson" });
    expect(
      resolveFileType(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/_members.json"
      )
    ).toEqual({ kind: "manifest", entityType: "video" });
    expect(
      resolveFileType(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/_members.json"
      )
    ).toEqual({ kind: "manifest", entityType: "timeline" });
    expect(
      resolveFileType(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/segments/_members.json"
      )
    ).toEqual({ kind: "manifest", entityType: "segment" });
  });

  it("resolves leaf file types", () => {
    expect(resolveFileType("/courses/my-course/course.json")).toEqual({
      kind: "leaf",
      entityType: "course",
    });
    expect(
      resolveFileType("/courses/my-course/sections/01-intro/section.json")
    ).toEqual({ kind: "leaf", entityType: "section" });
    expect(
      resolveFileType(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json"
      )
    ).toEqual({ kind: "leaf", entityType: "lesson" });
    expect(
      resolveFileType(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/video.json"
      )
    ).toEqual({ kind: "leaf", entityType: "video" });
    expect(
      resolveFileType(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/00.clip.json"
      )
    ).toEqual({ kind: "leaf", entityType: "clip" });
    expect(
      resolveFileType(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/00-opening.chapter.json"
      )
    ).toEqual({ kind: "leaf", entityType: "chapter" });
    expect(
      resolveFileType(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/segments/00-intro.json"
      )
    ).toEqual({ kind: "leaf", entityType: "segment" });
  });

  it("returns null for unrecognized paths", () => {
    expect(resolveFileType("/random/path.json")).toBeNull();
    expect(resolveFileType("/courses/my-course/unknown.json")).toBeNull();
  });
});

describe("R7 — read-before-write + staleness guard", () => {
  it("rejects when the file was never cat-ed", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/_members.json";
    const content = vfsCat(ctx.root, path);
    const result = deriveDiff(writeInput(path, content), [], ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("not-read");
      expect(result.rejection.message).toContain("must read");
    }
  });

  it("rejects when the hash has changed (stale)", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/_members.json";
    const content = vfsCat(ctx.root, path);
    const messages = makeMessages([
      { content, path, hash: "stale-hash-that-does-not-match" },
    ]);
    const result = deriveDiff(writeInput(path, content), messages, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("stale");
      expect(result.rejection.message).toContain("changed since");
    }
  });

  it("passes when the file was cat-ed and hash matches", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/_members.json";
    const stamp = stampCat(ctx.root, path);
    const messages = makeMessages([stamp]);
    const result = deriveDiff(writeInput(path, stamp.content), messages, ctx);
    expect(result.ok).toBe(true);
  });

  it("uses the most recent cat for a given path", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/_members.json";
    const staleStamp: CatStamp = { content: "old", path, hash: "old-hash" };
    const freshStamp = stampCat(ctx.root, path);
    const messages = makeMessages([staleStamp, freshStamp]);
    const result = deriveDiff(
      writeInput(path, freshStamp.content),
      messages,
      ctx
    );
    expect(result.ok).toBe(true);
  });
});

describe("invalid file path", () => {
  it("rejects writes to unrecognized file types", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/unknown.json";
    const messages = makeMessages([
      { content: "{}", path, hash: computeContentHash("{}") },
    ]);
    const result = deriveDiff(writeInput(path, "{}"), messages, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("invalid-file");
  });
});

describe("computeContentHash", () => {
  it("produces consistent hashes", () => {
    const content = '{"id": "test"}';
    expect(computeContentHash(content)).toBe(computeContentHash(content));
  });

  it("produces different hashes for different content", () => {
    expect(computeContentHash("a")).not.toBe(computeContentHash("b"));
  });
});

describe("parse errors", () => {
  it("rejects invalid JSON in proposed content", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/01-intro/section.json";
    const stamp = stampCat(ctx.root, path);
    const messages = makeMessages([stamp]);
    const result = deriveDiff(writeInput(path, "NOT JSON"), messages, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("parse-error");
  });

  it("rejects invalid manifest schema", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/_members.json";
    const stamp = stampCat(ctx.root, path);
    const messages = makeMessages([stamp]);
    const result = deriveDiff(
      writeInput(path, JSON.stringify([{ not_a_valid_field: true }])),
      messages,
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("parse-error");
  });

  it("includes path details in manifest validation errors", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/01-intro/lessons/_members.json";
    const stamp = stampCat(ctx.root, path);
    const messages = makeMessages([stamp]);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify([
          { id: "l1", slug: "hello", title: "Hello" },
          { id: "l2", slug: 123, title: null },
        ])
      ),
      messages,
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("parse-error");
      expect(result.rejection.message).toContain("[1].slug");
      expect(result.rejection.message).toContain("[1].title");
    }
  });
});

describe("file-not-found rejection", () => {
  it("rejects writes to a path that no longer exists in the VFS", () => {
    const ctx = buildCtx();
    const fakePath = "/courses/my-course/sections/99-gone/section.json";
    const messages = makeMessages([
      {
        content: '{"id":"x","slug":"gone","description":"","real":false}',
        path: fakePath,
        hash: computeContentHash(
          '{"id":"x","slug":"gone","description":"","real":false}'
        ),
      },
    ]);
    const result = deriveDiff(writeInput(fakePath, "{}"), messages, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("invalid-file");
  });
});

describe("deriveDiff never throws for validation failures", () => {
  it("returns rejection for all validation paths, never throws", () => {
    const ctx = buildCtx();
    const cases: Array<{ input: DiffInput; messages: DiffMessage[] }> = [
      {
        input: writeInput("/courses/my-course/course.json", "{}"),
        messages: [],
      },
      {
        input: writeInput("/courses/my-course/course.json", "{}"),
        messages: makeMessages([
          {
            content: "{}",
            path: "/courses/my-course/course.json",
            hash: "bad",
          },
        ]),
      },
      {
        input: writeInput("/courses/my-course/bogus.json", "{}"),
        messages: makeMessages([
          {
            content: "{}",
            path: "/courses/my-course/bogus.json",
            hash: computeContentHash("{}"),
          },
        ]),
      },
    ];
    for (const { input, messages } of cases) {
      const result = deriveDiff(input, messages, ctx);
      expect(result.ok).toBe(false);
    }
  });
});
