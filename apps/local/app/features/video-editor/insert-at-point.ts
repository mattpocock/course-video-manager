import type {
  FrontendInsertionPoint,
  TimelineItem,
} from "./clip-state-reducer.types";

const afterItem = (item: TimelineItem): FrontendInsertionPoint => {
  if (
    item.type === "chapter-on-database" ||
    item.type === "chapter-optimistically-added"
  ) {
    return { type: "after-chapter", frontendChapterId: item.frontendId };
  }
  return { type: "after-clip", frontendClipId: item.frontendId };
};

export const insertAtPoint = (
  items: TimelineItem[],
  newItem: TimelineItem,
  insertionPoint: FrontendInsertionPoint
): { items: TimelineItem[]; insertionPoint: FrontendInsertionPoint } => {
  if (insertionPoint.type === "end") {
    return {
      items: [...items, newItem],
      insertionPoint: { type: "end" },
    };
  }

  if (insertionPoint.type === "start") {
    return {
      items: [newItem, ...items],
      insertionPoint: afterItem(newItem),
    };
  }

  const targetId =
    insertionPoint.type === "after-clip"
      ? insertionPoint.frontendClipId
      : insertionPoint.frontendChapterId;

  const targetIndex = items.findIndex((item) => item.frontendId === targetId);

  if (targetIndex === -1) {
    throw new Error(`Target item not found when inserting after: ${targetId}`);
  }

  return {
    items: [
      ...items.slice(0, targetIndex + 1),
      newItem,
      ...items.slice(targetIndex + 1),
    ],
    insertionPoint: afterItem(newItem),
  };
};
