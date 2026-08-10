import { z } from "zod";

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

const CHANNEL_NAME = "cvm-diagrams";

let sendChannel: BroadcastChannel | null = null;
function getSendChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!sendChannel) sendChannel = new BroadcastChannel(CHANNEL_NAME);
  return sendChannel;
}

export function sendToChild(message: ParentToChildMessage): void {
  getSendChannel()?.postMessage(message);
}

export function sendToParent(message: ChildToParentMessage): void {
  getSendChannel()?.postMessage(message);
}

export function subscribeParent(
  handler: (message: ChildToParentMessage) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.onmessage = (e) => {
    const result = ChildToParent.safeParse(e.data);
    if (result.success) handler(result.data);
  };
  return () => ch.close();
}

export function subscribeChild(
  handler: (message: ParentToChildMessage) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.onmessage = (e) => {
    const result = ParentToChild.safeParse(e.data);
    if (result.success) handler(result.data);
  };
  return () => ch.close();
}
