import { z } from "zod";

export const streamDeckForwarderMessageSchema = z.object({
  type: z.enum([
    "delete-last-clip",
    "toggle-last-frame-of-video",
    "toggle-beat",
    "add-chapter",
    "clear-all-archived",
  ]),
});

export type StreamDeckForwarderMessage = z.infer<
  typeof streamDeckForwarderMessageSchema
>;

export const createStreamDeckForwarderMessage = (
  message: StreamDeckForwarderMessage
) => {
  return JSON.stringify(message);
};
