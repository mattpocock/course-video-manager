import type {
  ChapterOnDatabase,
  ChapterOptimisticallyAdded,
  ClipReducerAction,
  ClipReducerExec,
  ClipReducerState,
  FrontendInsertionPoint,
  TimelineItem,
} from "./clip-state-reducer.types";
import { createFrontendId } from "./clip-state-reducer.types";
import { insertAtPoint } from "./insert-at-point";

type ChapterAction = Extract<
  ClipReducerAction,
  {
    type:
      | "add-chapter"
      | "add-chapter-at"
      | "update-chapter"
      | "chapter-created"
      | "chapters-replaced";
  }
>;

const CHAPTER_ACTION_TYPES: ReadonlySet<string> = new Set([
  "add-chapter",
  "add-chapter-at",
  "update-chapter",
  "chapter-created",
  "chapters-replaced",
]);

export const isChapterAction = (
  action: ClipReducerAction
): action is ChapterAction => {
  return CHAPTER_ACTION_TYPES.has(action.type);
};

export const handleChapterAction = (
  state: ClipReducerState,
  action: ChapterAction,
  exec: ClipReducerExec
): ClipReducerState => {
  switch (action.type) {
    case "add-chapter":
      return handleAddChapter(state, action, exec);
    case "add-chapter-at":
      return handleAddChapterAt(state, action, exec);
    case "update-chapter":
      return handleUpdateChapter(state, action, exec);
    case "chapter-created":
      return handleChapterCreated(state, action);
    case "chapters-replaced":
      return handleChaptersReplaced(state, action);
  }
};

const handleAddChapter = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "add-chapter" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const newFrontendId = createFrontendId();
  const newChapter: ChapterOptimisticallyAdded = {
    type: "chapter-optimistically-added",
    frontendId: newFrontendId,
    name: action.name,
    insertionOrder: state.insertionOrder + 1,
  };

  const { items } = insertAtPoint(
    state.items,
    newChapter,
    state.insertionPoint
  );

  exec({
    type: "create-chapter",
    frontendId: newFrontendId,
    name: action.name,
    insertionPoint: state.insertionPoint,
  });

  exec({
    type: "scroll-to-insertion-point",
  });

  return {
    ...state,
    items,
    insertionOrder: state.insertionOrder + 1,
    insertionPoint: {
      type: "after-chapter",
      frontendChapterId: newFrontendId,
    },
  };
};

const handleAddChapterAt = (
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

  let newItems: TimelineItem[];
  if (action.position === "before") {
    newItems = [
      ...state.items.slice(0, targetIndex),
      newChapter,
      ...state.items.slice(targetIndex),
    ];
  } else {
    newItems = [
      ...state.items.slice(0, targetIndex + 1),
      newChapter,
      ...state.items.slice(targetIndex + 1),
    ];
  }

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

  return {
    ...state,
    items: newItems,
    insertionOrder: state.insertionOrder + 1,
  };
};

const handleUpdateChapter = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "update-chapter" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const chapter = state.items.find(
    (item) => item.frontendId === action.chapterId
  );
  if (
    !chapter ||
    (chapter.type !== "chapter-on-database" &&
      chapter.type !== "chapter-optimistically-added")
  ) {
    return state;
  }

  if (chapter.type === "chapter-on-database") {
    exec({
      type: "update-chapter",
      chapterId: chapter.databaseId,
      name: action.name,
    });
  }

  return {
    ...state,
    items: state.items.map((item) => {
      if (item.frontendId === action.chapterId) {
        return { ...item, name: action.name };
      }
      return item;
    }),
  };
};

const handleChapterCreated = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "chapter-created" }>
): ClipReducerState => {
  return {
    ...state,
    items: state.items.map((item) => {
      if (
        item.frontendId === action.frontendId &&
        item.type === "chapter-optimistically-added"
      ) {
        const onDatabase: ChapterOnDatabase = {
          type: "chapter-on-database",
          frontendId: item.frontendId,
          databaseId: action.databaseId,
          name: item.name,
          insertionOrder: item.insertionOrder,
        };
        return onDatabase;
      }
      return item;
    }),
  };
};

const handleChaptersReplaced = (
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
