import type {
  ClipReducerAction,
  ClipReducerExec,
  ClipReducerState,
  ChapterOnDatabase,
  ChapterOptimisticallyAdded,
  DatabaseId,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "./clip-state-reducer.types";
import { createFrontendId } from "./clip-state-reducer.types";

export const handleAddChapterAt = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "add-chapter-at" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const targetItem = state.items.find(
    (item) => item.frontendId === action.itemId
  );
  if (!targetItem) {
    return state;
  }

  const targetIndex = state.items.findIndex(
    (item) => item.frontendId === action.itemId
  );

  const newFrontendId = createFrontendId();
  const newChapter: ChapterOptimisticallyAdded = {
    type: "chapter-optimistically-added",
    frontendId: newFrontendId,
    name: action.name,
    insertionOrder: state.insertionOrder + 1,
  };

  // Insert at the correct position
  let newItems: TimelineItem[];
  if (action.position === "before") {
    newItems = [
      ...state.items.slice(0, targetIndex),
      newChapter,
      ...state.items.slice(targetIndex),
    ];
  } else {
    // after
    newItems = [
      ...state.items.slice(0, targetIndex + 1),
      newChapter,
      ...state.items.slice(targetIndex + 1),
    ];
  }

  // Fire the appropriate effect based on whether the target has a database ID
  if (
    targetItem.type === "on-database" ||
    targetItem.type === "chapter-on-database"
  ) {
    const targetDatabaseId = targetItem.databaseId;
    const targetItemType: "clip" | "chapter" =
      targetItem.type === "on-database" ? "clip" : "chapter";
    exec({
      type: "create-chapter-at",
      frontendId: newFrontendId,
      name: action.name,
      position: action.position,
      targetItemId: targetDatabaseId,
      targetItemType: targetItemType,
    });
  } else {
    // For optimistically added items, calculate the insertion point
    let insertionPoint: FrontendInsertionPoint;
    if (action.position === "after") {
      if (targetItem.type === "chapter-optimistically-added") {
        insertionPoint = {
          type: "after-chapter",
          frontendChapterId: targetItem.frontendId,
        };
      } else {
        insertionPoint = {
          type: "after-clip",
          frontendClipId: targetItem.frontendId,
        };
      }
    } else {
      // "before" - use the item before the target as insertion point
      if (targetIndex === 0) {
        insertionPoint = { type: "start" };
      } else {
        const prevItem = state.items[targetIndex - 1]!;
        if (
          prevItem.type === "on-database" ||
          prevItem.type === "optimistically-added"
        ) {
          insertionPoint = {
            type: "after-clip",
            frontendClipId: prevItem.frontendId,
          };
        } else {
          insertionPoint = {
            type: "after-chapter",
            frontendChapterId: prevItem.frontendId,
          };
        }
      }
    }
    exec({
      type: "create-chapter",
      frontendId: newFrontendId,
      name: action.name,
      insertionPoint,
    });
  }

  // Don't scroll when adding section via context menu - user is organizing content
  // and doesn't expect to be scrolled around

  return {
    ...state,
    items: newItems,
    insertionOrder: state.insertionOrder + 1,
    // Don't move insertion point - user is just organizing content via context menu
  };
};

type ArchiveClipMode =
  | {
      type: "move-insertion-point-to-previous-clip";
      originalClipIndex: number;
    }
  | {
      type: "do-nothing";
    };

export const archiveClips = (
  allItems: TimelineItem[],
  frontendIds: FrontendId[],
  insertionPoint: FrontendInsertionPoint
): {
  items: TimelineItem[];
  insertionPoint: FrontendInsertionPoint;
  clipsToArchive: Set<DatabaseId>;
  chaptersToArchive: Set<DatabaseId>;
} => {
  const clipsToArchive = new Set<DatabaseId>();
  const chaptersToArchive = new Set<DatabaseId>();

  let archiveClipMode: ArchiveClipMode;

  if (
    insertionPoint.type === "after-clip" &&
    frontendIds.includes(insertionPoint.frontendClipId)
  ) {
    const clipId = insertionPoint.frontendClipId;
    const prevClipIndex = allItems.findIndex((c) => c.frontendId === clipId);
    if (prevClipIndex === -1) {
      throw new Error("Previous clip not found when archiving");
    }
    archiveClipMode = {
      type: "move-insertion-point-to-previous-clip",
      originalClipIndex: prevClipIndex,
    };
  } else if (
    insertionPoint.type === "after-chapter" &&
    frontendIds.includes(insertionPoint.frontendChapterId)
  ) {
    const chapterId = insertionPoint.frontendChapterId;
    const prevClipIndex = allItems.findIndex((c) => c.frontendId === chapterId);
    if (prevClipIndex === -1) {
      throw new Error("Previous chapter not found when archiving");
    }
    archiveClipMode = {
      type: "move-insertion-point-to-previous-clip",
      originalClipIndex: prevClipIndex,
    };
  } else {
    archiveClipMode = {
      type: "do-nothing",
    };
  }

  const items: (TimelineItem | undefined)[] = [...allItems];
  for (const clipId of frontendIds) {
    const index = items.findIndex((c) => c?.frontendId === clipId);
    if (index === -1) continue;

    const itemToReplace = items[index]!;
    if (itemToReplace.type === "optimistically-added") {
      if (itemToReplace.isOrphaned) {
        items[index] = undefined;
      } else {
        itemToReplace.shouldArchive = true;
      }
    } else if (itemToReplace.type === "effect-clip-optimistically-added") {
      // Effect clips that haven't been persisted yet can just be removed
      items[index] = undefined;
    } else if (itemToReplace.type === "on-database") {
      clipsToArchive.add(itemToReplace.databaseId);
      items[index] = undefined;
    } else if (itemToReplace.type === "chapter-optimistically-added") {
      itemToReplace.shouldArchive = true;
    } else if (itemToReplace.type === "chapter-on-database") {
      chaptersToArchive.add(itemToReplace.databaseId);
      items[index] = undefined;
    }
  }

  // If the insertion point is after a clip, and that clip has been deleted,
  // we need to find a candidate for the insertion point
  if (archiveClipMode.type === "move-insertion-point-to-previous-clip") {
    const slicedItems = items.slice(0, archiveClipMode.originalClipIndex);

    const previousNonUndefinedItem = slicedItems.findLast(
      (c) => c !== undefined
    );

    let newInsertionPoint: FrontendInsertionPoint;

    if (previousNonUndefinedItem) {
      if (
        previousNonUndefinedItem.type === "on-database" ||
        previousNonUndefinedItem.type === "optimistically-added"
      ) {
        newInsertionPoint = {
          type: "after-clip",
          frontendClipId: previousNonUndefinedItem.frontendId,
        };
      } else {
        newInsertionPoint = {
          type: "after-chapter",
          frontendChapterId: previousNonUndefinedItem.frontendId,
        };
      }
    } else {
      newInsertionPoint = {
        type: "end",
      };
    }

    return {
      items: items.filter((c) => c !== undefined),
      insertionPoint: newInsertionPoint,
      clipsToArchive,
      chaptersToArchive,
    };
  }

  // When a chapter is deleted and the insertion point was not on it,
  // move the insertion point to the item before the deleted section
  const firstDeletedChapterIndex = frontendIds
    .map((id) => allItems.findIndex((item) => item.frontendId === id))
    .find((idx) => {
      const item = allItems[idx];
      return (
        item &&
        (item.type === "chapter-on-database" ||
          item.type === "chapter-optimistically-added")
      );
    });

  if (firstDeletedChapterIndex !== undefined) {
    const slicedItems = items.slice(0, firstDeletedChapterIndex);
    const previousItem = slicedItems.findLast((c) => c !== undefined);

    let newInsertionPoint: FrontendInsertionPoint;
    if (previousItem) {
      if (
        previousItem.type === "on-database" ||
        previousItem.type === "optimistically-added"
      ) {
        newInsertionPoint = {
          type: "after-clip",
          frontendClipId: previousItem.frontendId,
        };
      } else {
        newInsertionPoint = {
          type: "after-chapter",
          frontendChapterId: previousItem.frontendId,
        };
      }
    } else {
      newInsertionPoint = { type: "end" };
    }

    return {
      items: items.filter((c) => c !== undefined),
      insertionPoint: newInsertionPoint,
      clipsToArchive,
      chaptersToArchive,
    };
  }

  return {
    items: items.filter((c) => c !== undefined),
    insertionPoint: insertionPoint,
    clipsToArchive: clipsToArchive,
    chaptersToArchive: chaptersToArchive,
  };
};

export const handleChaptersReplaced = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "chapters-replaced" }>
): ClipReducerState => {
  const withoutSections = state.items.filter(
    (item) =>
      item.type !== "chapter-on-database" &&
      item.type !== "chapter-optimistically-added"
  );

  const newSectionByClipDbId = new Map(
    action.sections.map((s) => [s.beforeClipDatabaseId, s])
  );

  const newItems: TimelineItem[] = [];
  for (const item of withoutSections) {
    if (item.type === "on-database") {
      const match = newSectionByClipDbId.get(item.databaseId);
      if (match) {
        const sectionItem: ChapterOnDatabase = {
          type: "chapter-on-database",
          frontendId: createFrontendId(),
          databaseId: match.databaseId,
          name: match.name,
          insertionOrder: null,
        };
        newItems.push(sectionItem);
      }
    }
    newItems.push(item);
  }

  const ip = state.insertionPoint;
  const insertionStillValid =
    ip.type === "end" ||
    ip.type === "start" ||
    (ip.type === "after-clip" &&
      newItems.some((i) => i.frontendId === ip.frontendClipId));

  return {
    ...state,
    items: newItems,
    insertionPoint: insertionStillValid ? ip : { type: "end" },
  };
};
