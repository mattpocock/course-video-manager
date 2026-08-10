import { useReducer, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Loader2,
  CheckCircle2Icon,
  AlertTriangleIcon,
  Trash2Icon,
  MicIcon,
  CircleDotIcon,
  SquareIcon,
  UndoIcon,
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type OptimisticClipState = "optimistic" | "processing" | "orphaned";

type OptimisticClip = {
  id: string;
  insertionOrder: number;
  state: OptimisticClipState;
  scene: string;
  profile: string;
  shouldArchive: boolean;
  resolved: {
    text: string;
    databaseId: string;
  } | null;
};

type RecordingState = "idle" | "recording" | "stopped";

// ─── Reducer ─────────────────────────────────────────────────────────────────

type State = {
  clips: OptimisticClip[];
  recordingState: RecordingState;
  nextId: number;
  nextOrder: number;
};

type Action =
  | { type: "start-recording" }
  | { type: "stop-recording" }
  | { type: "speech-detected" }
  | {
      type: "clip-resolved";
      clipId: string;
      text: string;
      databaseId: string;
    }
  | { type: "mark-orphaned" }
  | { type: "mark-for-archive"; clipId: string }
  | { type: "restore-clip"; clipId: string }
  | { type: "dismiss-pending" }
  | { type: "permanently-remove-archived" }
  | { type: "reset" };

const initialState: State = {
  clips: [],
  recordingState: "idle",
  nextId: 1,
  nextOrder: 1,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "start-recording":
      return { ...state, recordingState: "recording" };

    case "stop-recording":
      return {
        ...state,
        recordingState: "stopped",
        clips: state.clips.map((c) =>
          c.state === "optimistic" ? { ...c, state: "processing" } : c
        ),
      };

    case "speech-detected": {
      const id = `clip-${state.nextId}`;
      const newClip: OptimisticClip = {
        id,
        insertionOrder: state.nextOrder,
        state: "optimistic",
        scene: "Camera",
        profile: "Landscape",
        shouldArchive: false,
        resolved: null,
      };
      return {
        ...state,
        clips: [...state.clips, newClip],
        nextId: state.nextId + 1,
        nextOrder: state.nextOrder + 1,
      };
    }

    case "clip-resolved": {
      return {
        ...state,
        clips: state.clips.map((c) =>
          c.id === action.clipId
            ? {
                ...c,
                resolved: {
                  text: action.text,
                  databaseId: action.databaseId,
                },
              }
            : c
        ),
      };
    }

    case "mark-orphaned":
      return {
        ...state,
        clips: state.clips.map((c) =>
          !c.resolved && (c.state === "optimistic" || c.state === "processing")
            ? { ...c, state: "orphaned" }
            : c
        ),
      };

    case "mark-for-archive":
      return {
        ...state,
        clips: state.clips.map((c) =>
          c.id === action.clipId ? { ...c, shouldArchive: true } : c
        ),
      };

    case "restore-clip":
      return {
        ...state,
        clips: state.clips.map((c) =>
          c.id === action.clipId ? { ...c, shouldArchive: false } : c
        ),
      };

    case "dismiss-pending":
      return {
        ...state,
        clips: state.clips.filter((c) => !(!c.resolved && !c.shouldArchive)),
      };

    case "permanently-remove-archived":
      return {
        ...state,
        clips: state.clips.filter((c) => !c.shouldArchive),
      };

    case "reset":
      return initialState;
  }
}

// ─── Selectors ───────────────────────────────────────────────────────────────

function selectTimelineClips(state: State): OptimisticClip[] {
  return state.clips
    .filter((c) => c.resolved && !c.shouldArchive)
    .sort((a, b) => a.insertionOrder - b.insertionOrder);
}

function selectPendingClips(state: State): OptimisticClip[] {
  return state.clips
    .filter((c) => !c.resolved && !c.shouldArchive)
    .sort((a, b) => a.insertionOrder - b.insertionOrder);
}

function selectArchivedClips(state: State): OptimisticClip[] {
  return state.clips
    .filter((c) => c.shouldArchive)
    .sort((a, b) => a.insertionOrder - b.insertionOrder);
}

function selectOrphanedCount(state: State): number {
  return selectPendingClips(state).filter((c) => c.state === "orphaned").length;
}

// ─── Resolve simulation helper ───────────────────────────────────────────────

const SAMPLE_TEXTS = [
  "So the first thing we need to understand about TypeScript generics is...",
  "Let me show you how this pattern works in practice.",
  "And that's why we use the infer keyword here.",
  "This is one of the most common mistakes I see beginners make.",
  "Now let's look at a more advanced example.",
];

function resolveNextClip(state: State, dispatch: React.Dispatch<Action>) {
  const next = state.clips.find(
    (c) => !c.resolved && (c.state === "optimistic" || c.state === "processing")
  );
  if (!next) return;
  dispatch({
    type: "clip-resolved",
    clipId: next.id,
    text: SAMPLE_TEXTS[Math.floor(Math.random() * SAMPLE_TEXTS.length)]!,
    databaseId: `db-${next.id}`,
  });
}

// ─── Control Panel ───────────────────────────────────────────────────────────

function ControlPanel({
  state,
  dispatch,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <div className="flex items-center gap-2 p-3 bg-background rounded-lg border border-border mb-4">
      <span className="text-xs text-muted-foreground mr-2 font-medium uppercase tracking-wider">
        Simulate:
      </span>
      {state.recordingState === "idle" && (
        <Button
          size="sm"
          variant="destructive"
          onClick={() => dispatch({ type: "start-recording" })}
        >
          <CircleDotIcon className="size-3" />
          Start Recording
        </Button>
      )}
      {state.recordingState === "recording" && (
        <>
          <Button
            size="sm"
            onClick={() => dispatch({ type: "speech-detected" })}
          >
            <MicIcon className="size-3" />
            Speech Detected
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => resolveNextClip(state, dispatch)}
          >
            <CheckCircle2Icon className="size-3" />
            Resolve Next
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              dispatch({ type: "stop-recording" });
              setTimeout(() => dispatch({ type: "mark-orphaned" }), 3000);
            }}
          >
            <SquareIcon className="size-3" />
            Stop Recording
          </Button>
        </>
      )}
      {state.recordingState === "stopped" && (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => resolveNextClip(state, dispatch)}
          >
            <CheckCircle2Icon className="size-3" />
            Resolve Next
          </Button>
          <span className="text-xs text-amber-400 ml-2">
            Recording stopped — orphans appear in 3s
          </span>
        </>
      )}
      <div className="ml-auto">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => dispatch({ type: "reset" })}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

// ─── Timeline Clip Row ───────────────────────────────────────────────────────

function TimelineClipRow({
  clip,
  onDelete,
}: {
  clip: OptimisticClip;
  onDelete: () => void;
}) {
  return (
    <div className="bg-card rounded-md text-left relative overflow-hidden flex w-full group">
      <div className="flex-shrink-0 relative w-32 aspect-[16/9] bg-muted rounded flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/40 to-purple-900/40" />
        <span className="text-[10px] text-muted-foreground z-10">0:03</span>
      </div>
      <div className="flex-1 flex items-center min-w-0 p-3">
        <span className="text-foreground text-sm leading-6 flex-1">
          {clip.resolved?.text}
        </span>
        <button
          onClick={onDelete}
          className="text-muted-foreground hover:text-red-400 p-1 rounded hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100"
          title="Delete clip"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Pending Clip Row ────────────────────────────────────────────────────────

function PendingClipRow({
  clip,
  onDelete,
}: {
  clip: OptimisticClip;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded text-sm",
        clip.state === "orphaned" ? "bg-amber-950/30" : "bg-card/50"
      )}
    >
      {clip.state === "orphaned" ? (
        <AlertTriangleIcon className="size-4 text-amber-500 shrink-0" />
      ) : (
        <Loader2 className="size-4 animate-spin text-blue-400 shrink-0" />
      )}
      <span
        className={cn(
          "flex-1",
          clip.state === "orphaned" ? "text-amber-300" : "text-muted-foreground"
        )}
      >
        {clip.state === "optimistic" && "Detecting silence..."}
        {clip.state === "processing" && "Processing..."}
        {clip.state === "orphaned" && "No clip found"}
      </span>
      <span className="text-[10px] text-muted-foreground">
        #{clip.insertionOrder} · {clip.scene} / {clip.profile}
      </span>
      <button
        onClick={onDelete}
        className="text-muted-foreground hover:text-red-400 p-1 rounded hover:bg-muted/50 transition-colors"
        title="Delete clip"
      >
        <Trash2Icon className="size-3.5" />
      </button>
    </div>
  );
}

// ─── Archived Clip Row ───────────────────────────────────────────────────────

function ArchivedClipRow({
  clip,
  onRestore,
}: {
  clip: OptimisticClip;
  onRestore: () => void;
}) {
  const isResolved = !!clip.resolved;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded text-sm bg-red-950/10">
      <ArchiveIcon className="size-3.5 text-red-400/50 shrink-0" />
      <span
        className={cn(
          "flex-1 line-through",
          isResolved ? "text-muted-foreground" : "text-muted-foreground/70"
        )}
      >
        {isResolved ? clip.resolved!.text : "Awaiting clip..."}
      </span>
      <span className="text-[10px] text-muted-foreground">
        #{clip.insertionOrder}
      </span>
      <button
        onClick={onRestore}
        className="text-muted-foreground hover:text-blue-400 text-xs flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/50 transition-colors"
      >
        <UndoIcon className="size-3" />
        Restore
      </button>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PrototypeOptimisticClips() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [archivedExpanded, setArchivedExpanded] = useState(true);

  const timelineClips = selectTimelineClips(state);
  const pendingClips = selectPendingClips(state);
  const archivedClips = selectArchivedClips(state);
  const orphanedCount = selectOrphanedCount(state);

  const hasPending = pendingClips.length > 0;
  const hasArchived = archivedClips.length > 0;
  const showBottomSection = hasPending || hasArchived;

  const totalActive = timelineClips.length + pendingClips.length;
  const resolvedCount = timelineClips.length;
  const progress = totalActive > 0 ? resolvedCount / totalActive : 0;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <h1 className="text-lg font-semibold">
          Pending Clips — Grouped Section with Recoverable Deletes
        </h1>
      </div>

      <div className="flex-1 overflow-hidden p-4 flex flex-col">
        <ControlPanel state={state} dispatch={dispatch} />

        <div className="text-xs text-muted-foreground px-1 mb-3">
          Delete a clip (pending or resolved) and it moves to the archived
          section. When its DB clip arrives, it stays archived but recoverable.
          Restoring puts it back in insertion order.
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl space-y-3">
            {/* ── Main timeline: resolved, non-archived clips ── */}
            <div className="space-y-2">
              {timelineClips.map((clip) => (
                <TimelineClipRow
                  key={clip.id}
                  clip={clip}
                  onDelete={() =>
                    dispatch({ type: "mark-for-archive", clipId: clip.id })
                  }
                />
              ))}
              {timelineClips.length === 0 && !showBottomSection && (
                <div className="text-center text-muted-foreground text-sm py-12">
                  Start recording and speak to create clips
                </div>
              )}
            </div>

            {/* ── Bottom section: pending + archived ── */}
            {showBottomSection && (
              <div className="rounded-lg border border-border overflow-hidden">
                {/* Header */}
                <div className="bg-card/80 px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-foreground">
                      Pending Clips
                    </span>
                    {totalActive > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {resolvedCount}/{totalActive} resolved
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {hasPending && (
                  <div className="h-1 bg-muted">
                    <div
                      className={cn(
                        "h-full transition-all duration-500",
                        orphanedCount > 0 ? "bg-amber-500" : "bg-blue-500"
                      )}
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                )}

                {/* Active pending clips */}
                {hasPending && (
                  <div className="p-2 space-y-1.5">
                    {pendingClips.map((clip) => (
                      <PendingClipRow
                        key={clip.id}
                        clip={clip}
                        onDelete={() =>
                          dispatch({
                            type: "mark-for-archive",
                            clipId: clip.id,
                          })
                        }
                      />
                    ))}
                  </div>
                )}

                {/* Archived / deleted clips sub-section */}
                {hasArchived && (
                  <div className="border-t border-border/50">
                    <button
                      onClick={() => setArchivedExpanded(!archivedExpanded)}
                      className="w-full px-4 py-2 flex items-center justify-between bg-red-950/20 hover:bg-red-950/30 transition-colors"
                    >
                      <span className="text-xs text-red-300/70 flex items-center gap-1.5">
                        {archivedExpanded ? (
                          <ChevronDownIcon className="size-3" />
                        ) : (
                          <ChevronRightIcon className="size-3" />
                        )}
                        {archivedClips.length} deleted
                        {archivedClips.some((c) => c.resolved)
                          ? " — restore to recover"
                          : " — will archive when resolved"}
                      </span>
                      <span
                        className="text-xs text-red-400 hover:text-red-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          dispatch({ type: "permanently-remove-archived" });
                        }}
                      >
                        Clear all
                      </span>
                    </button>
                    {archivedExpanded && (
                      <div className="p-2 space-y-1">
                        {archivedClips.map((clip) => (
                          <ArchivedClipRow
                            key={clip.id}
                            clip={clip}
                            onRestore={() =>
                              dispatch({
                                type: "restore-clip",
                                clipId: clip.id,
                              })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
