import type { BeatType } from "@/services/video-processing-service";
import type {
  Clip,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
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
import { createFrontendId, createSessionId } from "./clip-state-reducer.types";
import { DEFAULT_PAUSE_LENGTH } from "@/silence-detection-constants";
import {
  collectSnapshotForClip,
  emitSnapshotForClipEffects,
  type PendingSnapshotEffect,
} from "./clip-state-reducer-snapshot-pinning.helpers";

export const handleNewOptimisticClipDetected = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "new-optimistic-clip-detected" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  // Check if clip with same soundDetectionId already exists (deduplication for React StrictMode)
  const existingClip = state.items.find(
    (c) =>
      c.type === "optimistically-added" &&
      c.soundDetectionId === action.soundDetectionId
  );
  if (existingClip) {
    return state;
  }

  // Find active recording session, or auto-create one
  let sessions = state.sessions;
  let activeSession = sessions.find((s) => s.status === "recording");
  if (!activeSession) {
    const nextDisplayNumber =
      sessions.length > 0
        ? Math.max(...sessions.map((s) => s.displayNumber)) + 1
        : 1;
    activeSession = {
      id: createSessionId(),
      displayNumber: nextDisplayNumber,
      status: "recording",
      outputPath: "",
      startedAt: Date.now(),
      pauseLength: DEFAULT_PAUSE_LENGTH,
    };
    sessions = [...sessions, activeSession];
  }

  const newFrontendId = createFrontendId();
  const newClip: ClipOptimisticallyAdded = {
    type: "optimistically-added",
    frontendId: newFrontendId,
    scene: action.scene,
    profile: action.profile,
    insertionOrder: state.insertionOrder + 1,
    beatType: "none",
    soundDetectionId: action.soundDetectionId,
    sessionId: activeSession.id,
  };

  let newInsertionPoint: FrontendInsertionPoint = state.insertionPoint;

  let newClips: TimelineItem[];
  if (state.insertionPoint.type === "end") {
    // Append to end
    newClips = [...state.items, newClip];
  } else if (state.insertionPoint.type === "start") {
    // Insert at start
    newClips = [newClip, ...state.items];
    newInsertionPoint = {
      type: "after-clip",
      frontendClipId: newFrontendId,
    };
  } else if (state.insertionPoint.type === "after-clip") {
    const targetClipId = state.insertionPoint.frontendClipId;
    // Insert at insertion point
    const insertionPointIndex = state.items.findIndex(
      (c) => c.frontendId === targetClipId
    );
    if (insertionPointIndex === -1) {
      throw new Error("Target clip not found when inserting after");
    }
    newClips = [
      ...state.items.slice(0, insertionPointIndex + 1),
      newClip,
      ...state.items.slice(insertionPointIndex + 1),
    ];
    newInsertionPoint = {
      type: "after-clip",
      frontendClipId: newFrontendId,
    };
  } else {
    // after-chapter
    const targetChapterId = state.insertionPoint.frontendChapterId;
    // Insert at insertion point
    const insertionPointIndex = state.items.findIndex(
      (c) => c.frontendId === targetChapterId
    );
    if (insertionPointIndex === -1) {
      throw new Error("Target chapter not found when inserting after");
    }
    newClips = [
      ...state.items.slice(0, insertionPointIndex + 1),
      newClip,
      ...state.items.slice(insertionPointIndex + 1),
    ];
    newInsertionPoint = {
      type: "after-clip",
      frontendClipId: newFrontendId,
    };
  }

  exec({
    type: "scroll-to-insertion-point",
  });

  return {
    ...state,
    items: newClips,
    insertionOrder: state.insertionOrder + 1,
    insertionPoint: newInsertionPoint,
    sessions,
  };
};

const insertClip = (
  items: (TimelineItem | undefined)[],
  newClip: Clip,
  insertionPoint: FrontendInsertionPoint
) => {
  let newInsertionPoint: FrontendInsertionPoint = insertionPoint;

  let newItems: (TimelineItem | undefined)[];
  if (insertionPoint.type === "end") {
    // Append to end
    newItems = [...items, newClip];
  } else if (insertionPoint.type === "start") {
    // Insert at start
    newItems = [newClip, ...items];
    newInsertionPoint = {
      type: "after-clip",
      frontendClipId: newClip.frontendId,
    };
  } else if (insertionPoint.type === "after-clip") {
    const targetClipId = insertionPoint.frontendClipId;
    // Insert at insertion point
    const insertionPointIndex = items.findIndex(
      (c) => c?.frontendId === targetClipId
    );
    if (insertionPointIndex === -1) {
      throw new Error("Target clip not found when inserting after");
    }
    newItems = [
      ...items.slice(0, insertionPointIndex + 1),
      newClip,
      ...items.slice(insertionPointIndex + 1),
    ];
    newInsertionPoint = {
      type: "after-clip",
      frontendClipId: targetClipId,
    };
  } else if (insertionPoint.type === "after-chapter") {
    const targetChapterId = insertionPoint.frontendChapterId;
    // Insert at insertion point
    const insertionPointIndex = items.findIndex(
      (c) => c?.frontendId === targetChapterId
    );
    if (insertionPointIndex === -1) {
      throw new Error("Target chapter not found when inserting after");
    }
    newItems = [
      ...items.slice(0, insertionPointIndex + 1),
      newClip,
      ...items.slice(insertionPointIndex + 1),
    ];
    newInsertionPoint = {
      type: "after-clip",
      frontendClipId: newClip.frontendId,
    };
  } else {
    throw new Error("Unknown insertion point type");
  }

  return {
    clips: newItems,
    insertionPoint: newInsertionPoint,
  };
};

export const handleNewDatabaseClips = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "new-database-clips" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  let newClipsState: (TimelineItem | undefined)[] = [...state.items];

  const clipsToArchive = new Set<DatabaseId>();
  const databaseClipIdsToTranscribe = new Set<DatabaseId>();
  const frontendClipIdsToTranscribe = new Set<FrontendId>();
  const snapshotsToCreate: PendingSnapshotEffect[] = [];
  const clipsToUpdateScene = new Map<
    DatabaseId,
    { scene: string; profile: string; beatType: BeatType }
  >();

  let newInsertionPoint: FrontendInsertionPoint = state.insertionPoint;

  // When outputPath is provided, scope matching to the session with that
  // outputPath. This ensures DB clips from file A only pair with optimistic
  // clips from session A, not session B.
  const scopeBySession = action.outputPath !== undefined;
  const matchingSessionId = scopeBySession
    ? state.sessions.find((s) => s.outputPath === action.outputPath)?.id
    : undefined;

  const optimisticClipsSortedByInsertionOrder = newClipsState
    .filter(
      (c): c is ClipOptimisticallyAdded =>
        c?.type === "optimistically-added" &&
        // If scoped by session, only consider clips from the matching session
        // (if no session matches the outputPath, this filters out everything)
        (!scopeBySession || c.sessionId === matchingSessionId)
    )
    .sort((a, b) => {
      return a.insertionOrder! - b.insertionOrder!;
    });

  for (const databaseClip of action.clips) {
    const firstOfSortedClips = optimisticClipsSortedByInsertionOrder.shift();
    // Find the first optimistically added clip
    const index = newClipsState.findIndex(
      (c) =>
        c?.type === "optimistically-added" &&
        c.insertionOrder === firstOfSortedClips?.insertionOrder
    );

    if (firstOfSortedClips) {
      const frontendClip = newClipsState[index];

      const pendingSnapshot = collectSnapshotForClip(
        frontendClip,
        databaseClip.id
      );
      if (pendingSnapshot) snapshotsToCreate.push(pendingSnapshot);

      if (
        frontendClip?.type === "optimistically-added" &&
        frontendClip?.shouldArchive
      ) {
        const archivedDatabaseClip: ClipOnDatabase = {
          ...databaseClip,
          type: "on-database",
          frontendId: frontendClip.frontendId,
          databaseId: databaseClip.id,
          scene: frontendClip.scene,
          profile: frontendClip.profile,
          insertionOrder: frontendClip.insertionOrder,
          beatType: frontendClip.beatType,
          diagramSnapshotId: databaseClip.diagramSnapshotId ?? null,
          diagramName: null,
          shouldArchive: true,
          sessionId: frontendClip.sessionId,
        };
        newClipsState[index] = archivedDatabaseClip;
        clipsToArchive.add(databaseClip.id);
        clipsToUpdateScene.set(databaseClip.id, {
          scene: frontendClip.scene,
          profile: frontendClip.profile,
          beatType: frontendClip.beatType,
        });
        frontendClipIdsToTranscribe.add(frontendClip.frontendId);
        databaseClipIdsToTranscribe.add(databaseClip.id);
      } else if (frontendClip?.type === "optimistically-added") {
        const newDatabaseClip: ClipOnDatabase = {
          ...databaseClip,
          type: "on-database",
          frontendId: frontendClip.frontendId,
          databaseId: databaseClip.id,
          scene: frontendClip.scene,
          profile: frontendClip.profile,
          insertionOrder: frontendClip.insertionOrder,
          beatType: frontendClip.beatType,
          diagramSnapshotId: databaseClip.diagramSnapshotId ?? null,
          diagramName: null,
        };
        newClipsState[index] = newDatabaseClip;
        clipsToUpdateScene.set(databaseClip.id, {
          scene: frontendClip.scene,
          profile: frontendClip.profile,
          beatType: frontendClip.beatType,
        });
        frontendClipIdsToTranscribe.add(frontendClip.frontendId);
        databaseClipIdsToTranscribe.add(databaseClip.id);
      }
    } else {
      const newFrontendId = createFrontendId();

      const newDatabaseClip: ClipOnDatabase = {
        type: "on-database",
        ...databaseClip,
        frontendId: newFrontendId,
        databaseId: databaseClip.id,
        insertionOrder: state.insertionOrder + 1,
        beatType: databaseClip.beatType as BeatType,
        diagramSnapshotId: databaseClip.diagramSnapshotId ?? null,
        diagramName: null,
      };

      const result = insertClip(
        newClipsState,
        newDatabaseClip,
        state.insertionPoint
      );

      newClipsState = result.clips;
      newInsertionPoint = result.insertionPoint;

      frontendClipIdsToTranscribe.add(newFrontendId);
      databaseClipIdsToTranscribe.add(databaseClip.id);
    }
  }

  if (clipsToUpdateScene.size > 0) {
    exec({
      type: "update-clips",
      clips: Array.from(clipsToUpdateScene.entries()),
    });
  }

  if (action.clips.length > 0) {
    exec({
      type: "scroll-to-insertion-point",
    });
  }

  if (clipsToArchive.size > 0) {
    exec({
      type: "archive-clips",
      clipIds: Array.from(clipsToArchive),
    });
  }

  if (databaseClipIdsToTranscribe.size > 0) {
    exec({
      type: "transcribe-clips",
      clipIds: Array.from(databaseClipIdsToTranscribe),
    });
  }

  emitSnapshotForClipEffects(snapshotsToCreate, exec);

  return {
    ...state,
    clipIdsBeingTranscribed: new Set([
      ...Array.from(state.clipIdsBeingTranscribed),
      ...Array.from(frontendClipIdsToTranscribe),
    ]),
    items: newClipsState.filter((c) => c !== undefined),
    insertionPoint: newInsertionPoint,
  };
};

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
