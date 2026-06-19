import { describe, it, expect } from "vitest";
import { deriveDiff, type AddOp } from "./derive-diff";
import {
  fullCourse,
  buildCtx,
  makeMessages,
  stampCat,
  writeInput,
} from "./derive-diff-test-helpers";

describe("edge cases — empty manifests", () => {
  it("returns no ops when writing an identical manifest", () => {
    const ctx = buildCtx();
    const PATH = "/courses/my-course/sections/_members.json";
    const stamp = stampCat(ctx.root, PATH);
    const result = deriveDiff(
      writeInput(PATH, stamp.content),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ops).toHaveLength(0);
  });

  it("deletes all items when writing empty array to a deletable manifest", () => {
    const ctx = buildCtx();
    const PATH =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/_members.json";
    const stamp = stampCat(ctx.root, PATH);
    const result = deriveDiff(
      writeInput(PATH, "[]"),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops.filter((o) => o.type === "delete")).toHaveLength(1);
      expect(result.ops[0]!.type).toBe("delete");
    }
  });

  it("creates items from an empty before-state", () => {
    const emptySection = {
      ...fullCourse,
      sections: [
        {
          ...fullCourse.sections![0]!,
          lessons: [],
        },
        fullCourse.sections![1]!,
      ],
    };
    const ctx = buildCtx(emptySection);
    const PATH = "/courses/my-course/sections/01-intro/lessons/_members.json";
    const stamp = stampCat(ctx.root, PATH);
    const result = deriveDiff(
      writeInput(
        PATH,
        JSON.stringify(
          [{ id: null, slug: "brand-new", title: "Brand New" }],
          null,
          2
        )
      ),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0]!.type).toBe("add");
    }
  });
});

describe("edge cases — multiple clip copies in one write", () => {
  it("accepts multiple clip copies referencing the same footage", () => {
    const ctx = buildCtx();
    const PATH =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/_members.json";
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
              label: "Copy 1",
              videoFilename: "raw.mp4",
              sourceStartTime: 0,
              sourceEndTime: 3,
            },
            {
              id: null,
              type: "clip",
              label: "Copy 2",
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
      const adds = result.ops.filter((o) => o.type === "add");
      expect(adds).toHaveLength(2);
      expect((adds[0] as AddOp).sub).toBe("copy");
      expect((adds[1] as AddOp).sub).toBe("copy");
    }
  });
});

describe("edge cases — single-item manifests", () => {
  it("handles reorder with only one surviving item (no reorder op)", () => {
    const ctx = buildCtx();
    const PATH = "/courses/my-course/sections/01-intro/lessons/_members.json";
    const stamp = stampCat(ctx.root, PATH);
    const before = JSON.parse(stamp.content);
    const result = deriveDiff(
      writeInput(PATH, JSON.stringify([before[0]], null, 2)),
      makeMessages([stamp]),
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops.filter((o) => o.type === "delete")).toHaveLength(1);
      expect(result.ops.filter((o) => o.type === "reorder")).toHaveLength(0);
    }
  });
});
