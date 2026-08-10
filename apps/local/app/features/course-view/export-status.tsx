import { ContextMenuItem } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { FileVideo, FileX } from "lucide-react";
import { use } from "react";
import type { useFetcher } from "react-router";

type ExportedVideoMap = Promise<Record<string, boolean>>;

/**
 * Leaf consumers of the deferred `hasExportedVideoMap`. Each calls `use()` on
 * the promise itself, so the suspense boundary can sit directly around the tiny
 * bit of UI that needs the data — keeping the surrounding lesson/video chrome
 * out of the boundary so it never flickers while the map streams in.
 */

/** File-video icon whose colour reflects whether the video has been exported. */
export function VideoExportIcon({
  videoId,
  hasExportedVideoMap,
}: {
  videoId: string;
  hasExportedVideoMap: ExportedVideoMap;
}) {
  const map = use(hasExportedVideoMap);
  return (
    <FileVideo
      className={cn(
        "w-3 h-3 shrink-0",
        map[videoId] ? "text-muted-foreground" : "text-red-500"
      )}
    />
  );
}

/** Neutral icon shown while `hasExportedVideoMap` is still streaming in. */
export function VideoExportIconFallback() {
  return <FileVideo className="w-3 h-3 shrink-0 text-muted-foreground" />;
}

/** Small red dot over a thumbnail, shown only when the video is not exported. */
export function UnexportedDot({
  videoId,
  hasExportedVideoMap,
}: {
  videoId: string;
  hasExportedVideoMap: ExportedVideoMap;
}) {
  const map = use(hasExportedVideoMap);
  if (map[videoId]) return null;
  return (
    <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-red-500" />
  );
}

/** "Purge Export" context-menu item, shown only once the video is exported. */
export function PurgeExportMenuItem({
  videoId,
  hasExportedVideoMap,
  deleteVideoFileFetcher,
}: {
  videoId: string;
  hasExportedVideoMap: ExportedVideoMap;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
}) {
  const map = use(hasExportedVideoMap);
  if (!map[videoId]) return null;
  return (
    <ContextMenuItem
      variant="destructive"
      onSelect={() => {
        deleteVideoFileFetcher.submit(
          {},
          {
            method: "post",
            action: `/api/videos/${videoId}/purge-export`,
          }
        );
      }}
    >
      <FileX className="w-4 h-4" />
      Purge Export
    </ContextMenuItem>
  );
}
