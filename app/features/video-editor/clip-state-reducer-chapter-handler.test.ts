import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import type {
  ClipReducerExec,
  ClipReducerState,
  DatabaseId,
  FrontendId,
} from "./clip-state-reducer.types";
import {
  handleChapterAction,
  isChapterAction,
} from "./clip-state-reducer-chapters";

const createChapterState = (
  overrides: Partial<
    Pick<ClipReducerState, "items" | "insertionPoint" | "insertionOrder">
  > = {}
): ClipReducerState => ({
  items: [],
  clipIdsBeingTranscribed: new Set(),
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
  ...overrides,
});

const createExec = (): ClipReducerExec => vi.fn();

describe("chapter sub-handler", () => {
  describe("isChapterAction", () => {
    it("returns true for add-chapter", () => {
      expect(isChapterAction(fromPartial({ type: "add-chapter" }))).toBe(true);
    });

    it("returns true for add-chapter-at", () => {
      expect(isChapterAction(fromPartial({ type: "add-chapter-at" }))).toBe(
        true
      );
    });

    it("returns true for update-chapter", () => {
      expect(isChapterAction(fromPartial({ type: "update-chapter" }))).toBe(
        true
      );
    });

    it("returns true for chapter-created", () => {
      expect(isChapterAction(fromPartial({ type: "chapter-created" }))).toBe(
        true
      );
    });

    it("returns true for chapters-replaced", () => {
      expect(isChapterAction(fromPartial({ type: "chapters-replaced" }))).toBe(
        true
      );
    });

    it("returns false for non-chapter actions", () => {
      expect(isChapterAction(fromPartial({ type: "recording-started" }))).toBe(
        false
      );
      expect(isChapterAction(fromPartial({ type: "clips-deleted" }))).toBe(
        false
      );
    });
  });

  describe("add-chapter", () => {
    it("inserts an optimistic chapter at the end", () => {
      const exec = createExec();
      const state = handleChapterAction(
        createChapterState(),
        { type: "add-chapter", name: "Intro" },
        exec
      );

      expect(state.items).toHaveLength(1);
      expect(state.items[0]).toMatchObject({
        type: "chapter-optimistically-added",
        name: "Intro",
        insertionOrder: 1,
      });
    });

    it("advances insertion point to after the new chapter", () => {
      const exec = createExec();
      const state = handleChapterAction(
        createChapterState(),
        { type: "add-chapter", name: "Intro" },
        exec
      );

      expect(state.insertionPoint).toEqual({
        type: "after-chapter",
        frontendChapterId: state.items[0]!.frontendId,
      });
    });

    it("increments insertionOrder", () => {
      const exec = createExec();
      const state = handleChapterAction(
        createChapterState({ insertionOrder: 5 }),
        { type: "add-chapter", name: "Ch" },
        exec
      );

      expect(state.insertionOrder).toBe(6);
    });

    it("fires create-chapter and scroll-to-insertion-point effects", () => {
      const exec = createExec();
      handleChapterAction(
        createChapterState(),
        { type: "add-chapter", name: "Intro" },
        exec
      );

      expect(exec).toHaveBeenCalledWith(
        expect.objectContaining({ type: "create-chapter", name: "Intro" })
      );
      expect(exec).toHaveBeenCalledWith({ type: "scroll-to-insertion-point" });
    });
  });

  describe("update-chapter", () => {
    it("updates name of an optimistic chapter without firing effect", () => {
      const exec = createExec();
      const initial = createChapterState({
        items: [
          fromPartial({
            type: "chapter-optimistically-added",
            frontendId: "fe-ch" as FrontendId,
            name: "Old",
            insertionOrder: 1,
          }),
        ],
      });

      const state = handleChapterAction(
        initial,
        {
          type: "update-chapter",
          chapterId: "fe-ch" as FrontendId,
          name: "New",
        },
        exec
      );

      expect(state.items[0]).toMatchObject({ name: "New" });
      expect(exec).not.toHaveBeenCalled();
    });

    it("updates name of a database chapter and fires update-chapter effect", () => {
      const exec = createExec();
      const initial = createChapterState({
        items: [
          fromPartial({
            type: "chapter-on-database",
            frontendId: "fe-ch" as FrontendId,
            databaseId: "db-ch" as DatabaseId,
            name: "Old",
          }),
        ],
      });

      const state = handleChapterAction(
        initial,
        {
          type: "update-chapter",
          chapterId: "fe-ch" as FrontendId,
          name: "New",
        },
        exec
      );

      expect(state.items[0]).toMatchObject({ name: "New" });
      expect(exec).toHaveBeenCalledWith({
        type: "update-chapter",
        chapterId: "db-ch",
        name: "New",
      });
    });

    it("returns state unchanged for unknown chapterId", () => {
      const exec = createExec();
      const initial = createChapterState();

      const state = handleChapterAction(
        initial,
        {
          type: "update-chapter",
          chapterId: "nonexistent" as FrontendId,
          name: "X",
        },
        exec
      );

      expect(state).toBe(initial);
    });
  });

  describe("chapter-created", () => {
    it("transitions optimistic chapter to on-database", () => {
      const exec = createExec();
      const initial = createChapterState({
        items: [
          fromPartial({
            type: "chapter-optimistically-added",
            frontendId: "fe-ch" as FrontendId,
            name: "Section 1",
            insertionOrder: 1,
          }),
        ],
      });

      const state = handleChapterAction(
        initial,
        {
          type: "chapter-created",
          frontendId: "fe-ch" as FrontendId,
          databaseId: "db-ch" as DatabaseId,
        },
        exec
      );

      expect(state.items[0]).toMatchObject({
        type: "chapter-on-database",
        frontendId: "fe-ch",
        databaseId: "db-ch",
        name: "Section 1",
        insertionOrder: 1,
      });
    });
  });

  describe("chapters-replaced", () => {
    it("replaces all chapters with new ones based on clip positions", () => {
      const exec = createExec();
      const initial = createChapterState({
        items: [
          fromPartial({
            type: "on-database",
            frontendId: "fe-1" as FrontendId,
            databaseId: "db-1" as DatabaseId,
          }),
          fromPartial({
            type: "chapter-on-database",
            frontendId: "fe-old" as FrontendId,
            databaseId: "db-old" as DatabaseId,
            name: "Old",
          }),
          fromPartial({
            type: "on-database",
            frontendId: "fe-2" as FrontendId,
            databaseId: "db-2" as DatabaseId,
          }),
        ],
      });

      const state = handleChapterAction(
        initial,
        {
          type: "chapters-replaced",
          sections: [
            {
              databaseId: "db-new" as DatabaseId,
              name: "New Section",
              beforeClipDatabaseId: "db-2" as DatabaseId,
            },
          ],
        },
        exec
      );

      expect(state.items).toHaveLength(3);
      expect(state.items[0]).toMatchObject({ databaseId: "db-1" });
      expect(state.items[1]).toMatchObject({
        type: "chapter-on-database",
        databaseId: "db-new",
        name: "New Section",
      });
      expect(state.items[2]).toMatchObject({ databaseId: "db-2" });
    });

    it("resets insertion point to end when it pointed at a removed chapter", () => {
      const exec = createExec();
      const initial = createChapterState({
        items: [
          fromPartial({
            type: "chapter-on-database",
            frontendId: "fe-ch" as FrontendId,
            databaseId: "db-ch" as DatabaseId,
            name: "Old",
          }),
        ],
        insertionPoint: {
          type: "after-chapter",
          frontendChapterId: "fe-ch" as FrontendId,
        },
      });

      const state = handleChapterAction(
        initial,
        { type: "chapters-replaced", sections: [] },
        exec
      );

      expect(state.insertionPoint).toEqual({ type: "end" });
    });
  });

  describe("add-chapter-at", () => {
    it("inserts a chapter before a database clip", () => {
      const exec = createExec();
      const initial = createChapterState({
        items: [
          fromPartial({
            type: "on-database",
            frontendId: "fe-1" as FrontendId,
            databaseId: "db-1" as DatabaseId,
          }),
        ],
      });

      const state = handleChapterAction(
        initial,
        {
          type: "add-chapter-at",
          name: "Before Clip",
          position: "before",
          itemId: "fe-1" as FrontendId,
        },
        exec
      );

      expect(state.items).toHaveLength(2);
      expect(state.items[0]).toMatchObject({
        type: "chapter-optimistically-added",
        name: "Before Clip",
      });
      expect(state.items[1]).toMatchObject({ databaseId: "db-1" });
    });

    it("fires create-chapter-at effect for database targets", () => {
      const exec = createExec();
      const initial = createChapterState({
        items: [
          fromPartial({
            type: "on-database",
            frontendId: "fe-1" as FrontendId,
            databaseId: "db-1" as DatabaseId,
          }),
        ],
      });

      handleChapterAction(
        initial,
        {
          type: "add-chapter-at",
          name: "New",
          position: "after",
          itemId: "fe-1" as FrontendId,
        },
        exec
      );

      expect(exec).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "create-chapter-at",
          targetItemId: "db-1",
          targetItemType: "clip",
          position: "after",
        })
      );
    });

    it("does not move insertion point", () => {
      const exec = createExec();
      const initial = createChapterState({
        items: [
          fromPartial({
            type: "on-database",
            frontendId: "fe-1" as FrontendId,
            databaseId: "db-1" as DatabaseId,
          }),
        ],
        insertionPoint: { type: "end" },
      });

      const state = handleChapterAction(
        initial,
        {
          type: "add-chapter-at",
          name: "New",
          position: "after",
          itemId: "fe-1" as FrontendId,
        },
        exec
      );

      expect(state.insertionPoint).toEqual({ type: "end" });
    });
  });
});
