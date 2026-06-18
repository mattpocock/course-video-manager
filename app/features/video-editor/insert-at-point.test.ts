import { describe, expect, it } from "vitest";
import { insertAtPoint } from "./insert-at-point";
import type {
  ClipOnDatabase,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "./clip-state-reducer.types";

const clipItem = (frontendId: string): TimelineItem => {
  const clip: ClipOnDatabase = {
    type: "on-database",
    frontendId: frontendId as FrontendId,
    databaseId: `db-${frontendId}` as any,
    videoFilename: "test.mp4",
    sourceStartTime: 0,
    sourceEndTime: 1,
    text: "",
    transcribedAt: null,
    scene: "default",
    profile: "default",
    insertionOrder: 1,
    beatType: "none",
    diagramSnapshotId: null,
    diagramName: null,
  };
  return clip;
};

const chapterItem = (frontendId: string): TimelineItem => ({
  type: "chapter-on-database",
  frontendId: frontendId as FrontendId,
  databaseId: `db-${frontendId}` as any,
  name: `Chapter ${frontendId}`,
  insertionOrder: 1,
});

const optimisticChapter = (frontendId: string): TimelineItem => ({
  type: "chapter-optimistically-added",
  frontendId: frontendId as FrontendId,
  name: `Chapter ${frontendId}`,
  insertionOrder: 1,
});

describe("insertAtPoint", () => {
  describe("insert at start", () => {
    it("should prepend to empty items and advance insertion point to after-clip", () => {
      const newClip = clipItem("new");
      const result = insertAtPoint([], newClip, { type: "start" });

      expect(result.items).toEqual([newClip]);
      expect(result.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: "new",
      });
    });

    it("should prepend to existing items and advance insertion point", () => {
      const existing = clipItem("a");
      const newClip = clipItem("new");
      const result = insertAtPoint([existing], newClip, { type: "start" });

      expect(result.items).toEqual([newClip, existing]);
      expect(result.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: "new",
      });
    });

    it("should advance to after-chapter when inserting a chapter at start", () => {
      const existing = clipItem("a");
      const newChapter = chapterItem("ch1");
      const result = insertAtPoint([existing], newChapter, { type: "start" });

      expect(result.items).toEqual([newChapter, existing]);
      expect(result.insertionPoint).toEqual({
        type: "after-chapter",
        frontendChapterId: "ch1",
      });
    });
  });

  describe("insert at end", () => {
    it("should append to empty items and keep insertion point at end", () => {
      const newClip = clipItem("new");
      const result = insertAtPoint([], newClip, { type: "end" });

      expect(result.items).toEqual([newClip]);
      expect(result.insertionPoint).toEqual({ type: "end" });
    });

    it("should append to existing items and keep insertion point at end", () => {
      const existing = clipItem("a");
      const newClip = clipItem("new");
      const result = insertAtPoint([existing], newClip, { type: "end" });

      expect(result.items).toEqual([existing, newClip]);
      expect(result.insertionPoint).toEqual({ type: "end" });
    });
  });

  describe("insert after-clip", () => {
    it("should splice after the target clip and advance insertion point", () => {
      const a = clipItem("a");
      const b = clipItem("b");
      const newClip = clipItem("new");

      const insertionPoint: FrontendInsertionPoint = {
        type: "after-clip",
        frontendClipId: "a" as FrontendId,
      };

      const result = insertAtPoint([a, b], newClip, insertionPoint);

      expect(result.items).toEqual([a, newClip, b]);
      expect(result.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: "new",
      });
    });

    it("should throw when target clip is not found", () => {
      const newClip = clipItem("new");

      const insertionPoint: FrontendInsertionPoint = {
        type: "after-clip",
        frontendClipId: "nonexistent" as FrontendId,
      };

      expect(() => insertAtPoint([], newClip, insertionPoint)).toThrow(
        "Target item not found"
      );
    });

    it("should insert a chapter after a clip and advance to after-chapter", () => {
      const a = clipItem("a");
      const b = clipItem("b");
      const newChapter = optimisticChapter("ch1");

      const insertionPoint: FrontendInsertionPoint = {
        type: "after-clip",
        frontendClipId: "a" as FrontendId,
      };

      const result = insertAtPoint([a, b], newChapter, insertionPoint);

      expect(result.items).toEqual([a, newChapter, b]);
      expect(result.insertionPoint).toEqual({
        type: "after-chapter",
        frontendChapterId: "ch1",
      });
    });
  });

  describe("insert after-chapter", () => {
    it("should splice after the target chapter and advance insertion point", () => {
      const ch = chapterItem("ch1");
      const a = clipItem("a");
      const newClip = clipItem("new");

      const insertionPoint: FrontendInsertionPoint = {
        type: "after-chapter",
        frontendChapterId: "ch1" as FrontendId,
      };

      const result = insertAtPoint([ch, a], newClip, insertionPoint);

      expect(result.items).toEqual([ch, newClip, a]);
      expect(result.insertionPoint).toEqual({
        type: "after-clip",
        frontendClipId: "new",
      });
    });

    it("should throw when target chapter is not found", () => {
      const newClip = clipItem("new");

      const insertionPoint: FrontendInsertionPoint = {
        type: "after-chapter",
        frontendChapterId: "nonexistent" as FrontendId,
      };

      expect(() => insertAtPoint([], newClip, insertionPoint)).toThrow(
        "Target item not found"
      );
    });
  });

  describe("does not mutate inputs", () => {
    it("should return a new items array without mutating the original", () => {
      const original = [clipItem("a"), clipItem("b")];
      const frozen = [...original];
      const newClip = clipItem("new");

      const result = insertAtPoint(original, newClip, { type: "end" });

      expect(original).toEqual(frozen);
      expect(result.items).not.toBe(original);
    });
  });
});
