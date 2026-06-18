import type { BeatType } from "@/services/video-processing-service";
import { DEFAULT_PAUSE_LENGTH } from "@/silence-detection-constants";
import { shouldSnapshot } from "@/lib/snapshot-rule";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  ClipReducerAction,
  ClipReducerExec,
  ClipReducerState,
  DatabaseId,
  FrontendId,
  FrontendInsertionPoint,
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer.types";
import { createFrontendId, createSessionId } from "./clip-state-reducer.types";
import { insertAtPoint } from "./insert-at-point";

type RecordingAction = Extract<
  ClipReducerAction,
  {
    type:
      | "recording-started"
      | "recording-stopped"
      | "session-polling-complete"
      | "new-optimistic-clip-detected"
      | "new-database-clips"
      | "clip-audio-window-closed";
  }
>;

const RECORDING_ACTION_TYPES: ReadonlySet<string> = new Set([
  "recording-started",
  "recording-stopped",
  "session-polling-complete",
  "new-optimistic-clip-detected",
  "new-database-clips",
  "clip-audio-window-closed",
]);

export const isRecordingAction = (
  action: ClipReducerAction
): action is RecordingAction => {
  return RECORDING_ACTION_TYPES.has(action.type);
};

export const handleRecordingAction = (
  state: ClipReducerState,
  action: RecordingAction,
  exec: ClipReducerExec
): ClipReducerState => {
  switch (action.type) {
    case "recording-started":
      return handleRecordingStarted(state, action, exec);
    case "recording-stopped":
      return handleRecordingStopped(state, exec);
    case "session-polling-complete":
      return handleSessionPollingComplete(state, action, exec);
    case "new-optimistic-clip-detected":
      return handleNewOptimisticClipDetected(state, action, exec);
    case "new-database-clips":
      return handleNewDatabaseClips(state, action, exec);
    case "clip-audio-window-closed":
      return handleClipAudioWindowClosed(state, action);
  }
};

const handleRecordingStarted = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "recording-started" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const nextDisplayNumber =
    state.sessions.length > 0
      ? Math.max(...state.sessions.map((s) => s.displayNumber)) + 1
      : 1;

  const newSession: RecordingSession = {
    id: createSessionId(),
    displayNumber: nextDisplayNumber,
    status: "recording",
    outputPath: action.outputPath,
    startedAt: Date.now(),
    pauseLength: action.pauseLength,
  };

  exec({
    type: "start-session-polling",
    sessionId: newSession.id,
    outputPath: action.outputPath,
    pauseLength: action.pauseLength,
  });

  exec({
    type: "scroll-to-insertion-point",
  });

  return {
    ...state,
    sessions: [...state.sessions, newSession],
  };
};

const handleRecordingStopped = (
  state: ClipReducerState,
  exec: ClipReducerExec
): ClipReducerState => {
  const activeSession = state.sessions.find((s) => s.status === "recording");
  if (!activeSession) {
    return state;
  }

  exec({
    type: "start-session-timeout",
    sessionId: activeSession.id,
  });

  return {
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === activeSession.id ? { ...s, status: "polling" } : s
    ),
  };
};

const handleSessionPollingComplete = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "session-polling-complete" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const session = state.sessions.find((s) => s.id === action.sessionId);
  if (!session || session.status === "done") {
    return state;
  }

  const allSessionsDone = state.sessions.every((s) =>
    s.id === action.sessionId ? true : s.status === "done"
  );

  if (allSessionsDone) {
    exec({ type: "revalidate-loader" });
  }

  return {
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === action.sessionId ? { ...s, status: "done" } : s
    ),
    items: state.items.map((item) => {
      if (
        item.type === "optimistically-added" &&
        item.sessionId === action.sessionId &&
        !item.shouldArchive
      ) {
        return { ...item, isOrphaned: true };
      }
      return item;
    }),
  };
};

const handleNewOptimisticClipDetected = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "new-optimistic-clip-detected" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const existingClip = state.items.find(
    (c) =>
      c.type === "optimistically-added" &&
      c.soundDetectionId === action.soundDetectionId
  );
  if (existingClip) {
    return state;
  }

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

  const { items, insertionPoint } = insertAtPoint(
    state.items,
    newClip,
    state.insertionPoint
  );

  exec({
    type: "scroll-to-insertion-point",
  });

  return {
    ...state,
    items,
    insertionOrder: state.insertionOrder + 1,
    insertionPoint,
    sessions,
  };
};

type PendingSnapshotEffect = {
  diagramId: string;
  clipId: DatabaseId;
};

const collectSnapshotForClip = (
  frontendClip: TimelineItem | undefined,
  databaseClipId: DatabaseId
): PendingSnapshotEffect | null => {
  if (
    frontendClip?.type !== "optimistically-added" ||
    !frontendClip.pendingSnapshot ||
    !frontendClip.pendingSnapshot.activeDiagramId
  ) {
    return null;
  }
  if (
    !shouldSnapshot({
      activeDiagramId: frontendClip.pendingSnapshot.activeDiagramId,
      diagramFocusedDuringClip: frontendClip.pendingSnapshot.diagramFocused,
    })
  ) {
    return null;
  }
  return {
    diagramId: frontendClip.pendingSnapshot.activeDiagramId,
    clipId: databaseClipId,
  };
};

const emitSnapshotForClipEffects = (
  snapshots: PendingSnapshotEffect[],
  exec: ClipReducerExec
) => {
  for (const snapshot of snapshots) {
    exec({
      type: "snapshot-for-clip",
      diagramId: snapshot.diagramId,
      clipId: snapshot.clipId,
    });
  }
};

const handleNewDatabaseClips = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "new-database-clips" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  let newClipsState: TimelineItem[] = [...state.items];

  const clipsToArchive = new Set<DatabaseId>();
  const databaseClipIdsToTranscribe = new Set<DatabaseId>();
  const frontendClipIdsToTranscribe = new Set<FrontendId>();
  const snapshotsToCreate: PendingSnapshotEffect[] = [];
  const clipsToUpdateScene = new Map<
    DatabaseId,
    { scene: string; profile: string; beatType: BeatType }
  >();

  let newInsertionPoint: FrontendInsertionPoint = state.insertionPoint;

  const scopeBySession = action.outputPath !== undefined;
  const matchingSessionId = scopeBySession
    ? state.sessions.find((s) => s.outputPath === action.outputPath)?.id
    : undefined;

  const optimisticClipsSortedByInsertionOrder = newClipsState
    .filter(
      (c): c is ClipOptimisticallyAdded =>
        c.type === "optimistically-added" &&
        (!scopeBySession || c.sessionId === matchingSessionId)
    )
    .sort((a, b) => {
      return a.insertionOrder! - b.insertionOrder!;
    });

  for (const databaseClip of action.clips) {
    const firstOfSortedClips = optimisticClipsSortedByInsertionOrder.shift();
    const index = newClipsState.findIndex(
      (c) =>
        c.type === "optimistically-added" &&
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

      const result = insertAtPoint(
        newClipsState,
        newDatabaseClip,
        state.insertionPoint
      );

      newClipsState = result.items;
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
    items: newClipsState,
    insertionPoint: newInsertionPoint,
  };
};

const handleClipAudioWindowClosed = (
  state: ClipReducerState,
  action: {
    sessionId: SessionId;
    activeDiagramId: string | null;
    diagramFocused: boolean;
  }
): ClipReducerState => {
  let targetIndex = -1;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]!;
    if (
      item.type === "optimistically-added" &&
      item.sessionId === action.sessionId &&
      item.pendingSnapshot === undefined
    ) {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) return state;

  return {
    ...state,
    items: state.items.map((item, i) =>
      i === targetIndex && item.type === "optimistically-added"
        ? {
            ...item,
            pendingSnapshot: {
              activeDiagramId: action.activeDiagramId,
              diagramFocused: action.diagramFocused,
            },
          }
        : item
    ),
  };
};
