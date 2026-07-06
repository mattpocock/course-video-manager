import { describe, it, expect } from "vitest";
import { deriveDiff, type EditFieldOp } from "./derive-diff";
import {
  buildCtx,
  makeMessages,
  stampCat,
  writeInput,
} from "./derive-diff-test-helpers";

describe("leaf diff — edit fields", () => {
  it("detects lesson field edit (title)", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, title: "Hello World" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "edit");
      expect(ops).toHaveLength(1);
      const op = ops[0] as EditFieldOp;
      expect(op.field).toBe("title");
      expect(op.before).toBe("Hello");
      expect(op.after).toBe("Hello World");
    }
  });

  it("detects multiple field edits on a lesson", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify(
          {
            ...before,
            title: "New Title",
            description: "New Description",
            priority: 5,
          },
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "edit");
      expect(ops).toHaveLength(3);
      const fields = ops.map((o) => (o as EditFieldOp).field).sort();
      expect(fields).toEqual(["description", "priority", "title"]);
    }
  });

  it("detects section field edit (description)", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/01-intro/section.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, description: "Updated intro" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops.filter((o) => o.type === "edit")).toHaveLength(1);
      expect((result.ops[0] as EditFieldOp).field).toBe("description");
    }
  });

  it("detects section slug edit", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/01-intro/section.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, slug: "introduction" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.ops[0] as EditFieldOp).field).toBe("slug");
  });

  it("detects video name edit", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/video.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, name: "take-1-renamed" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.ops[0] as EditFieldOp).field).toBe("name");
  });

  it("detects clip text edit", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/01.clip.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, text: "Updated text" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.ops[0] as EditFieldOp).field).toBe("text");
      expect((result.ops[0] as EditFieldOp).entityType).toBe("clip");
    }
  });

  it("detects chapter name edit", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/00-opening.chapter.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, name: "Introduction" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect((result.ops[0] as EditFieldOp).entityType).toBe("chapter");
  });

  it("detects beat field edits", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/beats/00-intro.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify(
          { ...before, title: "Updated Intro", description: "New description" },
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "edit");
      expect(ops).toHaveLength(2);
      const fields = ops.map((o) => (o as EditFieldOp).field).sort();
      expect(fields).toEqual(["description", "title"]);
    }
  });

  it("returns no ops when content is unchanged", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json";
    const stamp = stampCat(ctx.root, path);
    const result = deriveDiff(
      writeInput(path, stamp.content),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ops).toHaveLength(0);
  });
});

describe("R3/R4 — forbidden field edits", () => {
  it("rejects editing any course field", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/course.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, name: "Changed Name" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("forbidden-op");
  });

  it("rejects editing section real field", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/sections/01-intro/section.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(path, JSON.stringify({ ...before, real: false }, null, 2)),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("real");
  });

  it("rejects editing clip scene field", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/01.clip.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, scene: "new-scene" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("scene");
  });

  it("rejects editing clip pauseType field", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/01.clip.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, pauseType: "dramatic" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.message).toContain("pauseType");
  });

  it("rejects editing clip profile field", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/01.clip.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, profile: "new-profile" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("forbidden-op");
  });

  it("rejects editing video originalFootagePath", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/video.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify(
          { ...before, originalFootagePath: "/new/path.mp4" },
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.rejection.message).toContain("originalFootagePath");
  });

  it("rejects editing video warnings", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/video.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, warnings: [{ kind: "fake" }] }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("forbidden-op");
  });
});

describe("R3 — atomic reject (any forbidden op => reject entire write)", () => {
  it("rejects the entire write when one edit field is forbidden", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/01.clip.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, text: "OK change", scene: "bad" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("forbidden-op");
  });
});

describe("edit tool — applyEdits reconstruction", () => {
  it("reconstructs after-file from edits and diffs correctly", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json";
    const stamp = stampCat(ctx.root, path);
    const result = deriveDiff(
      {
        path,
        edits: [
          {
            type: "replace" as const,
            old_text: '"Hello"',
            new_text: '"Hello Updated"',
          },
        ],
      },
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "edit");
      expect(ops).toHaveLength(1);
      expect((ops[0] as EditFieldOp).field).toBe("title");
      expect((ops[0] as EditFieldOp).after).toBe("Hello Updated");
    }
  });

  it("rejects when applyEdits fails", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json";
    const stamp = stampCat(ctx.root, path);
    const result = deriveDiff(
      {
        path,
        edits: [
          {
            type: "replace" as const,
            old_text: "THIS TEXT DOES NOT EXIST IN THE FILE",
            new_text: "replacement",
          },
        ],
      },
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("edit-error");
  });
});

describe("lesson editable fields — every allowed field", () => {
  const LESSON_PATH =
    "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json";
  const allowedFields = [
    "title",
    "slug",
    "description",
    "icon",
    "priority",
    "dependencies",
    "authoringStatus",
    "fsStatus",
  ] as const;

  for (const field of allowedFields) {
    it(`allows editing "${field}"`, () => {
      const ctx = buildCtx();
      const stamp = stampCat(ctx.root, LESSON_PATH);
      const before = JSON.parse(stamp.content);
      const modified = { ...before };

      switch (field) {
        case "title":
          modified.title = "Changed Title";
          break;
        case "slug":
          modified.slug = "changed-slug";
          break;
        case "description":
          modified.description = "Changed description";
          break;
        case "icon":
          modified.icon = "star";
          break;
        case "priority":
          modified.priority = 5;
          break;
        case "dependencies":
          modified.dependencies = ["l2"];
          break;
        case "authoringStatus":
          modified.authoringStatus = "done";
          break;
        case "fsStatus":
          modified.fsStatus = "ghost";
          break;
      }

      const result = deriveDiff(
        writeInput(LESSON_PATH, JSON.stringify(modified, null, 2)),
        makeMessages([stamp]),
        ctx
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ops = result.ops.filter((o) => o.type === "edit");
        expect(ops.length).toBeGreaterThanOrEqual(1);
        expect(ops.map((o) => (o as EditFieldOp).field)).toContain(field);
      }
    });
  }
});
