import { CircleDotIcon, Loader2, PlusIcon } from "lucide-react";
import { useMemo } from "react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "@/features/video-editor/video-editor-context";
import { streamClipList, type StreamClipRow } from "./stream-clip-list";

const Row = ({ row }: { row: StreamClipRow }) => {
  switch (row.kind) {
    case "clip":
      return (
        <p className="truncate px-2 py-0.5 text-xs text-muted-foreground">
          {row.text}
        </p>
      );
    case "take":
      return (
        <p
          className="flex items-center gap-2 px-2 py-0.5 text-xs text-blue-500"
          data-testid="stream-clip-list-take"
        >
          {row.recording ? (
            <CircleDotIcon className="size-3 animate-pulse" />
          ) : (
            <Loader2 className="size-3 animate-spin" />
          )}
          {row.recording ? "Detecting silence…" : "Processing…"}
        </p>
      );
    case "chapter":
      return (
        <p className="px-2 pt-2 text-xs font-medium text-foreground">
          {row.name}
        </p>
      );
    case "insertion-point":
      return (
        <div className="flex items-center gap-2 px-2 py-0.5">
          <div className="flex-1 border-t border-dashed border-blue-400" />
          <PlusIcon className="size-3 text-blue-400" />
          <div className="flex-1 border-t border-dashed border-blue-400" />
        </div>
      );
  }
};

/**
 * The Streaming tab's compact, read-only Clip list (`streamClipList`): one
 * line per Clip, Takes forming at the Insertion Point. No editing, no replay.
 */
export const StreamClipListView = () => {
  const items = useContextSelector(VideoEditorContext, (ctx) => ctx.allItems);
  const sessions = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.sessions
  );
  const insertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.insertionPoint
  );
  const rows = useMemo(
    () => streamClipList({ items, sessions, insertionPoint }),
    [items, sessions, insertionPoint]
  );

  return (
    <div
      className="h-full overflow-y-auto rounded-lg border bg-card/40 py-1"
      data-testid="stream-clip-list"
    >
      {rows.map((row) => (
        <Row
          key={row.kind === "insertion-point" ? "insertion-point" : row.id}
          row={row}
        />
      ))}
    </div>
  );
};
