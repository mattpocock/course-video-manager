import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2, Maximize2, Trash2 } from "lucide-react";
import { Fragment } from "react";
import type { ClipMockupListRow } from "@/routes/api.clip-mockup-editor";
import {
  ClipMockupDndProvider,
  ClipMockupSortableList,
  SortableClipMockup,
} from "./clip-mockup-dnd-context";
import { clipMockupFrameUrl } from "./clip-mockup-frame-url";
import { ClipMockupLineEditor } from "./clip-mockup-line-editor";
import type { ClipMockupFailure, ClipMockupPending } from "./use-clip-mockups";

/**
 * A Video's Animatic as an ordered list: position, frame, line.
 *
 * The surface for SMALL CORRECTIONS after a watch — retyping a line that read
 * badly, dropping a frame that no longer earns its place, pulling one Clip
 * Mockup a slot earlier. Large changes go back to the authoring agent in chat,
 * which is why there is no "add" here: a Clip Mockup needs a picture, and
 * pictures come from the agent.
 */
export function ClipMockupList({
  clipMockups,
  pending,
  failure,
  onSetLine,
  onMove,
  onDelete,
}: {
  clipMockups: ClipMockupListRow[];
  pending: ClipMockupPending | null;
  failure: ClipMockupFailure | null;
  onSetLine: (clipMockupId: string, line: string) => void;
  onMove: (clipMockupId: string, beforeClipMockupId: string | null) => void;
  onDelete: (clipMockupId: string) => void;
}) {
  if (clipMockups.length === 0) {
    return (
      <div className="text-xs text-muted-foreground/70 space-y-1 py-4">
        <p className="font-medium text-muted-foreground">
          No Clip Mockups yet.
        </p>
        <p>
          An Animatic is authored by the agent — ask it for a mock of this
          video, or run <code className="text-[11px]">cvm clip-mockup add</code>
          . They show up here to be corrected, not created.
        </p>
      </div>
    );
  }

  const ids = clipMockups.map((row) => row.id);

  return (
    <ClipMockupDndProvider
      clipMockupIds={ids}
      onMove={(drop) => onMove(drop.clipMockupId, drop.beforeClipMockupId)}
    >
      <ClipMockupSortableList clipMockupIds={ids} className="space-y-1.5">
        {clipMockups.map((row, index) => (
          <Fragment key={row.id}>
            <SortableClipMockup id={row.id}>
              <ClipMockupRow
                row={row}
                position={index + 1}
                pending={pending?.clipMockupId === row.id ? pending : null}
                failure={
                  failure?.clipMockupId === row.id ? failure.message : null
                }
                onSetLine={(line) => onSetLine(row.id, line)}
                onDelete={() => onDelete(row.id)}
              />
            </SortableClipMockup>
          </Fragment>
        ))}
      </ClipMockupSortableList>
    </ClipMockupDndProvider>
  );
}

/** Seconds as the author reads them off a row: one decimal, never rounded away. */
function formatDuration(durationSeconds: number): string {
  return `${durationSeconds.toFixed(1)}s`;
}

function ClipMockupRow({
  row,
  position,
  pending,
  failure,
  onSetLine,
  onDelete,
}: {
  row: ClipMockupListRow;
  position: number;
  pending: ClipMockupPending | null;
  failure: string | null;
  onSetLine: (line: string) => void;
  onDelete: () => void;
}) {
  const isSavingLine = pending?.kind === "line";
  const frameUrl = clipMockupFrameUrl(row.id);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group flex items-start gap-2 rounded px-1 py-1 hover:bg-muted/40",
            pending !== null && "opacity-70"
          )}
        >
          {/* The number the author reads out loud — "number 14 is too dense" — and
          the same one `clip-mockup --at` counts to, because both are this
          list's order. */}
          <span className="w-5 shrink-0 pt-1 text-right text-[11px] tabular-nums text-muted-foreground">
            {position}
          </span>

          {/* The frame, and the way to see it properly. A new tab rather than a
          lightbox: the author is comparing it against the timeline beside it. */}
          <a
            href={frameUrl}
            target="_blank"
            rel="noreferrer"
            title="Open the frame at full size"
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={frameUrl}
              alt={`Frame ${position}`}
              className="w-20 aspect-video rounded border border-border object-cover bg-muted"
            />
          </a>

          <div className="min-w-0 flex-1 space-y-0.5">
            <ClipMockupLineEditor
              line={row.line}
              isSaving={isSavingLine}
              onSave={onSetLine}
            />
            <div className="flex items-center gap-1.5 pl-2 text-[11px] text-muted-foreground/70">
              {isSavingLine ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Re-voicing the line…</span>
                </>
              ) : (
                <span className="tabular-nums">
                  {formatDuration(row.durationSeconds)}
                </span>
              )}
            </div>
            {failure && (
              <p className="flex items-start gap-1 pl-2 text-[11px] text-destructive">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>{failure}</span>
              </p>
            )}
          </div>

          <button
            type="button"
            title="Delete this Clip Mockup"
            disabled={pending !== null}
            className="shrink-0 mt-1 text-muted-foreground/0 group-hover:text-muted-foreground/50 hover:!text-destructive transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>

      {/* The second door onto the row's actions: the same two the row already
          carries — the frame link and the hover trash — in the same order,
          destructive last. */}
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem
            onSelect={() => {
              window.open(frameUrl, "_blank", "noreferrer");
            }}
          >
            <Maximize2 className="w-4 h-4" />
            Open frame at full size
          </ContextMenuItem>
        </ContextMenuGroup>

        <ContextMenuSeparator />

        <ContextMenuGroup>
          <ContextMenuItem
            variant="destructive"
            disabled={pending !== null}
            onSelect={() => {
              onDelete();
            }}
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
