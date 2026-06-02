import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { CourseEditorEventSchema } from "./course-editor-service.schemas";

const decode = Schema.decodeUnknownSync(CourseEditorEventSchema);

describe("CourseEditorEventSchema", () => {
  describe("create-section", () => {
    it("preserves adjacentSectionId and position when provided", () => {
      const input = {
        type: "create-section" as const,
        repoVersionId: "ver-1",
        title: "Beta",
        maxOrder: 2,
        adjacentSectionId: "sec-1",
        position: "before" as const,
      };

      const result = decode(input);

      expect(result).toMatchObject({
        adjacentSectionId: "sec-1",
        position: "before",
      });
    });

    it("accepts create-section without adjacentSectionId and position", () => {
      const input = {
        type: "create-section" as const,
        repoVersionId: "ver-1",
        title: "Alpha",
        maxOrder: 0,
      };

      const result = decode(input);

      expect(result).toMatchObject({
        type: "create-section",
        repoVersionId: "ver-1",
        title: "Alpha",
        maxOrder: 0,
      });
      expect(result).not.toHaveProperty("adjacentSectionId");
      expect(result).not.toHaveProperty("position");
    });
  });
});
