import { z } from "zod";
import { createPopupChannel } from "./popup-channel";

export const ParentToChild = z.discriminatedUnion("type", [
  z.object({ type: z.literal("loadDiagram"), diagramId: z.string() }),
  z.object({ type: z.literal("flush") }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("editorConnected") }),
  z.object({ type: z.literal("editorDisconnected") }),
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

export const diagramChannel = createPopupChannel({
  name: "cvm-diagrams",
  url: "/diagram-playground",
  windowFeatures: "popup,width=1100,height=800",
  toChild: ParentToChild,
  toParent: ChildToParent,
});
