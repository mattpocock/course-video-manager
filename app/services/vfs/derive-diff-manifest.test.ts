import { describe, it, expect } from "vitest";
import {
  deriveDiff,
  type ArchivedEntity,
  type AddOp,
  type DeleteOp,
  type ReorderOp,
} from "./derive-diff";
import {
  fullCourse,
  buildCtx,
  makeMessages,
  stampCat,
  writeInput,
} from "./derive-diff-test-helpers";

describe("manifest diff — sections", () => {
  const PATH = "/courses/my-course/sections/_members.json";

  it("detects reorder", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(PATH, JSON.stringify([before[1], before[0]], null, 2)),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "reorder");
      expect(ops).toHaveLength(1);
      expect((ops[0] as ReorderOp).entityType).toBe("section");
      expect((ops[0] as ReorderOp).order[0]!.fromIndex).toBe(1);
    }
  });

  it("detects add (create ghost section)", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify([...before, { id: null, slug: "new-section" }], null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "add");
      expect(ops).toHaveLength(1);
      expect((ops[0] as AddOp).sub).toBe("create");
    }
  });

  it("detects delete of empty section", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          before.filter((m: { id: string }) => m.id !== "s2"),
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "delete");
      expect(ops).toHaveLength(1);
      expect((ops[0] as DeleteOp).id).toBe("s2");
    }
  });

  it("rejects delete of non-empty section", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          before.filter((m: { id: string }) => m.id !== "s1"),
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("non-empty-section");
      expect(result.rejection.message).toContain("still contains lessons");
    }
  });
});

describe("manifest diff — lessons", () => {
  const PATH = "/courses/my-course/sections/01-intro/lessons/_members.json";

  it("detects lesson reorder", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(PATH, JSON.stringify([before[1], before[0]], null, 2)),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.ops.filter((o) => o.type === "reorder")).toHaveLength(1);
  });

  it("detects lesson add (create ghost)", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [...before, { id: null, slug: "new-lesson", title: "New Lesson" }],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "add");
      expect(ops).toHaveLength(1);
      expect((ops[0] as AddOp).sub).toBe("create");
      expect((ops[0] as AddOp).entityType).toBe("lesson");
    }
  });

  it("detects lesson delete", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(PATH, JSON.stringify(before.slice(1), null, 2)),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "delete");
      expect(ops).toHaveLength(1);
      expect((ops[0] as DeleteOp).id).toBe("l1");
    }
  });

  it("detects lesson unarchive (R8 two-step move)", () => {
    const archived = new Map<string, ArchivedEntity>([
      [
        "l-archived",
        { entityType: "lesson", parentLabel: "Section: Advanced" },
      ],
    ]);
    const ctx = buildCtx(fullCourse, archived);
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [
            ...before,
            {
              id: "l-archived",
              slug: "archived-lesson",
              title: "Archived Lesson",
            },
          ],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "add");
      expect(ops).toHaveLength(1);
      const op = ops[0] as AddOp;
      expect(op.sub).toBe("unarchive");
      expect(op.detail.sourceParent).toBe("Section: Advanced");
      expect(result.note).toContain("Step 2 of 2");
    }
  });
});

describe("manifest diff — videos", () => {
  const PATH =
    "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/_members.json";

  it("detects video add", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify([...before, { id: null, name: "take-2" }], null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "add");
      expect(ops).toHaveLength(1);
      expect((ops[0] as AddOp).sub).toBe("create");
      expect((ops[0] as AddOp).entityType).toBe("video");
    }
  });

  it("detects video delete", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const result = deriveDiff(
      writeInput(PATH, "[]"),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "delete");
      expect(ops).toHaveLength(1);
      expect((ops[0] as DeleteOp).entityType).toBe("video");
    }
  });

  it("detects video unarchive", () => {
    const archived = new Map<string, ArchivedEntity>([
      ["vid-archived", { entityType: "video", parentLabel: "Lesson: Hello" }],
    ]);
    const ctx = buildCtx(fullCourse, archived);
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [...before, { id: "vid-archived", name: "old-take" }],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "add");
      expect(ops).toHaveLength(1);
      expect((ops[0] as AddOp).sub).toBe("unarchive");
      expect(result.note).toContain("Step 2 of 2");
    }
  });
});

describe("manifest diff — segments", () => {
  const PATH =
    "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/segments/_members.json";

  it("detects segment add", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [...before, { id: null, kind: "quest", title: "New Quest" }],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops.filter((o) => o.type === "add")).toHaveLength(1);
    }
  });

  it("detects segment delete", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(PATH, JSON.stringify(before.slice(1), null, 2)),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.ops.filter((o) => o.type === "delete")).toHaveLength(1);
  });

  it("detects segment reorder", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(PATH, JSON.stringify([before[1], before[0]], null, 2)),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.ops.filter((o) => o.type === "reorder")).toHaveLength(1);
  });
});

describe("manifest diff — timeline", () => {
  const PATH =
    "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/_members.json";

  it("detects chapter add", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [...before, { id: null, type: "chapter", label: "Conclusion" }],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "add");
      expect(ops).toHaveLength(1);
      expect((ops[0] as AddOp).entityType).toBe("chapter");
    }
  });

  it("detects clip copy with matching footage", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [
            ...before,
            {
              id: null,
              type: "clip",
              label: "Copy of first clip",
              videoFilename: "raw.mp4",
              sourceStartTime: 0,
              sourceEndTime: 3,
            },
          ],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "add");
      expect(ops).toHaveLength(1);
      const op = ops[0] as AddOp;
      expect(op.sub).toBe("copy");
      expect(op.detail.footageMatch).toEqual({
        videoFilename: "raw.mp4",
        sourceStartTime: 0,
        sourceEndTime: 3,
      });
    }
  });

  it("rejects clip add without footage match", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [
            ...before,
            {
              id: null,
              type: "clip",
              label: "Made up clip",
              videoFilename: "nonexistent.mp4",
              sourceStartTime: 100,
              sourceEndTime: 200,
            },
          ],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("forbidden-op");
      expect(result.rejection.message).toContain("no existing clip matches");
    }
  });

  it("rejects clip add without footage fields", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [...before, { id: null, type: "clip", label: "bare clip" }],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("forbidden-op");
      expect(result.rejection.message).toContain("source footage");
    }
  });

  it("detects chapter delete", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          before.filter((m: { type: string }) => m.type !== "chapter"),
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "delete");
      expect(ops).toHaveLength(1);
      expect((ops[0] as DeleteOp).entityType).toBe("chapter");
    }
  });

  it("detects clip delete", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          before.filter((m: { id: string }) => m.id !== "cl1"),
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = result.ops.filter((o) => o.type === "delete");
      expect(ops).toHaveLength(1);
      expect((ops[0] as DeleteOp).entityType).toBe("clip");
    }
  });

  it("detects timeline reorder", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(PATH, JSON.stringify([...before].reverse(), null, 2)),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.ops.filter((o) => o.type === "reorder")).toHaveLength(1);
  });
});

describe("R6 — identity errors", () => {
  const LESSON_PATH =
    "/courses/my-course/sections/01-intro/lessons/_members.json";

  it("rejects duplicate ids in the proposed manifest", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, LESSON_PATH);
    const result = deriveDiff(
      writeInput(
        LESSON_PATH,
        JSON.stringify(
          [
            { id: "l1", slug: "hello", title: "Hello" },
            { id: "l1", slug: "hello-dup", title: "Hello Dup" },
          ],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("identity-error");
      expect(result.rejection.message).toContain("Duplicate id");
    }
  });

  it("rejects unknown ids in the proposed manifest", () => {
    const ctx = buildCtx();
    const stamp = stampCat(ctx.root, LESSON_PATH);
    const result = deriveDiff(
      writeInput(
        LESSON_PATH,
        JSON.stringify(
          [
            { id: "l1", slug: "hello", title: "Hello" },
            { id: "totally-made-up-id", slug: "fake", title: "Fake" },
          ],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("identity-error");
      expect(result.rejection.message).toContain("Unknown id");
    }
  });

  it("rejects id change on a leaf file", () => {
    const ctx = buildCtx();
    const path =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, id: "different-id" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("identity-error");
      expect(result.rejection.message).toContain("Cannot change the id");
    }
  });
});

describe("unarchive restrictions", () => {
  it("rejects unarchive of a segment (only lessons/videos allowed)", () => {
    const archived = new Map<string, ArchivedEntity>([
      ["seg-archived", { entityType: "segment", parentLabel: "Video: take-1" }],
    ]);
    const PATH =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/segments/_members.json";
    const ctx = buildCtx(fullCourse, archived);
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [
            ...before,
            { id: "seg-archived", kind: "quest", title: "Archived Segment" },
          ],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.kind).toBe("forbidden-op");
      expect(result.rejection.message).toContain("Only lessons and videos");
    }
  });
});

describe("combined operations in a single manifest write", () => {
  it("detects add + delete in one manifest write", () => {
    const ctx = buildCtx();
    const PATH = "/courses/my-course/sections/01-intro/lessons/_members.json";
    const stamp = stampCat(ctx.root, PATH);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [
            { id: "l2", slug: "world", title: "World" },
            { id: null, slug: "new-lesson", title: "Brand New" },
          ],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops.filter((o) => o.type === "delete")).toHaveLength(1);
      expect(result.ops.filter((o) => o.type === "add")).toHaveLength(1);
    }
  });

  it("detects reorder + delete in one manifest write", () => {
    const ctx = buildCtx();
    const PATH =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/_members.json";
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const modified = before
      .filter((m: { id: string }) => m.id !== "ch1")
      .reverse();
    const result = deriveDiff(
      writeInput(PATH, JSON.stringify(modified, null, 2)),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops.filter((o) => o.type === "delete")).toHaveLength(1);
      expect(result.ops.filter((o) => o.type === "reorder")).toHaveLength(1);
    }
  });
});

describe("course-level restrictions", () => {
  it("rejects course field edits (no editable fields)", () => {
    const ctx = buildCtx();
    const path = "/courses/my-course/course.json";
    const stamp = stampCat(ctx.root, path);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(
        path,
        JSON.stringify({ ...before, memory: "new memory" }, null, 2)
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.kind).toBe("forbidden-op");
  });
});
