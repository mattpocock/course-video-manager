import { z } from "zod";
import { VIDEO_FORMATS } from "@/features/videos/video-format";
import { createPopupChannel } from "./popup-channel";

export const ParentToChild = z.discriminatedUnion("type", [
  /**
   * Open `diagramId`. With `snapshotId`, go on to that DiagramSnapshot by a
   * Restore to Head, as clicking its Snapshot Timeline row does.
   */
  z.object({
    type: z.literal("loadDiagram"),
    diagramId: z.string(),
    snapshotId: z.string().optional(),
  }),
  z.object({ type: z.literal("flush") }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("editorConnected") }),
  z.object({ type: z.literal("editorDisconnected") }),
  /**
   * Sent when recording starts or stops, and repeated with every pong.
   * `format` is the Video's, so the playground centres for what the take
   * shows (a Short shows only the screen's left square).
   */
  z.object({
    type: z.literal("recordingStatus"),
    recording: z.boolean(),
    format: z.enum(VIDEO_FORMATS),
  }),
  z.object({
    type: z.literal("snapshotForClip"),
    diagramId: z.string(),
    clipId: z.string(),
  }),
]);

export const ChildToParent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("focus") }),
  z.object({ type: z.literal("blur") }),
  z.object({ type: z.literal("flushAck") }),
  z.object({
    type: z.literal("activeDiagramChanged"),
    diagramId: z.string().nullable(),
  }),
  z.object({ type: z.literal("ping") }),
  /**
   * The Active Diagram's Diagram Text, from the live canvas: sent when it
   * changes and with every ping. `diagramId: null` (and `text: ""`) when the
   * playground leaves the diagram or closes.
   */
  z.object({
    type: z.literal("activeDiagramText"),
    diagramId: z.string().nullable(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("snapshotForClipDone"),
    clipId: z.string(),
    ok: z.boolean(),
    snapshotId: z.string().nullable(),
    diagramName: z.string().nullable(),
  }),
]);

export type ParentToChildMessage = z.infer<typeof ParentToChild>;
export type ChildToParentMessage = z.infer<typeof ChildToParent>;

/**
 * The Active Diagram page's URL for `diagramId`. With `snapshotId`, the page
 * goes on to that DiagramSnapshot by a Restore to Head.
 */
export function playgroundUrl(diagramId: string, snapshotId?: string): string {
  const path = `/diagram-playground/${encodeURIComponent(diagramId)}`;
  return snapshotId
    ? `${path}?snapshot=${encodeURIComponent(snapshotId)}`
    : path;
}

/**
 * The Active Diagram page's URL for `diagramId`, with `snapshotId` (if any)
 * highlighted in its Snapshot Timeline. Unlike `playgroundUrl`, nothing is
 * restored: the head stays as it is.
 */
export function highlightedSnapshotUrl(
  diagramId: string,
  snapshotId: string | null
): string {
  const path = `/diagram-playground/${encodeURIComponent(diagramId)}`;
  return snapshotId
    ? `${path}?highlight=${encodeURIComponent(snapshotId)}`
    : path;
}

export const diagramChannel = createPopupChannel({
  name: "cvm-diagrams",
  url: "/diagram-playground",
  windowFeatures: "popup,width=1100,height=800",
  toChild: ParentToChild,
  toParent: ChildToParent,
});
