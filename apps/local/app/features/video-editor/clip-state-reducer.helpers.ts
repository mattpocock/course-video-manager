import type {
  DatabaseId,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "./clip-state-reducer.types";

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
      itemToReplace.shouldArchive = true;
    } else if (itemToReplace.type === "chapter-optimistically-added") {
      itemToReplace.shouldArchive = true;
    } else if (itemToReplace.type === "chapter-on-database") {
      chaptersToArchive.add(itemToReplace.databaseId);
      items[index] = undefined;
    }
  }

  const isVisibleItem = (
    item: TimelineItem | undefined
  ): item is TimelineItem => {
    if (item === undefined) return false;
    if ("shouldArchive" in item && item.shouldArchive) return false;
    return true;
  };

  // If the insertion point is after a clip, and that clip has been deleted,
  // we need to find a candidate for the insertion point
  if (archiveClipMode.type === "move-insertion-point-to-previous-clip") {
    const slicedItems = items.slice(0, archiveClipMode.originalClipIndex);

    const previousVisibleItem = slicedItems.findLast(isVisibleItem);

    let newInsertionPoint: FrontendInsertionPoint;

    if (previousVisibleItem) {
      if (
        previousVisibleItem.type === "on-database" ||
        previousVisibleItem.type === "optimistically-added"
      ) {
        newInsertionPoint = {
          type: "after-clip",
          frontendClipId: previousVisibleItem.frontendId,
        };
      } else {
        newInsertionPoint = {
          type: "after-chapter",
          frontendChapterId: previousVisibleItem.frontendId,
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
    const previousItem = slicedItems.findLast(isVisibleItem);

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
