import { z } from "zod";
import type { StreamDeckPress } from "../recorder-service/protocol";

export const streamDeckForwarderMessageSchema = z.object({
  type: z.enum([
    "delete-last-clip",
    "toggle-last-frame-of-video",
    "toggle-pause",
    "add-chapter",
    "clear-all-archived",
    // Consumed only by the /teleprompter route. The Video Editor's dispatch
    // is an if/else chain, so it ignores these rather than throwing.
    "teleprompter-advance",
    "teleprompter-back",
    "teleprompter-toggle-play",
    "teleprompter-reset",
  ]),
});

export type StreamDeckForwarderMessage = z.infer<
  typeof streamDeckForwarderMessageSchema
>;

/**
 * The New recorder's buttons: each HTTP path, and the press the forwarder
 * passes on to the recorder service (not to the hub, so an editor on an OBS
 * Video never hears them). The service acts on whichever Video the recorder
 * is open for; the editor follows its events. OBS Videos keep Elgato's OBS
 * plugin buttons.
 */
export const STREAM_DECK_RECORDER_PRESSES: Record<string, StreamDeckPress> = {
  "/api/start-recording": { action: "record" },
  "/api/stop-recording": { action: "stop" },
  "/api/scene-camera": { action: "switch-scene", scene: "Camera" },
  "/api/scene-code": { action: "switch-scene", scene: "Code" },
  "/api/scene-no-face": { action: "switch-scene", scene: "No Face" },
};

/**
 * Browser link-capture messages.
 *
 * These are broadcast over the same forwarder hub (ws://localhost:5172) by the
 * Chrome extension (see `chrome-extension/`). The extension is a dumb event tap:
 * it emits a `browser-focus` whenever Chrome gains/loses OS focus, and a
 * `browser-url` whenever the active tab's URL changes (tab switch or navigation).
 * The Video Editor reconstructs the live `(activeUrl, chromeFocused)` timeline
 * from this stream and attaches on-screen URLs to the clip being recorded.
 *
 * The hub rebroadcasts every client message to every client, so these coexist
 * with the Stream Deck messages above. Consumers that only care about one family
 * (e.g. `use-websocket.ts` only handles Stream Deck actions) must ignore the
 * other family gracefully rather than throwing on parse.
 */
export const browserFocusMessageSchema = z.object({
  type: z.literal("browser-focus"),
  /** True when the Chrome browser window is the foreground OS window. */
  focused: z.boolean(),
  /** `Date.now()` stamped by the extension. Same machine, same clock. */
  ts: z.number(),
});

export const browserUrlMessageSchema = z.object({
  type: z.literal("browser-url"),
  /**
   * The raw URL of the now-active tab (may be a non-web URL such as
   * `chrome://newtab/` — the Video Editor decides what is capturable).
   */
  url: z.string(),
  /** The active tab's page title, when the extension can read it. */
  title: z.string().optional(),
  /** `Date.now()` stamped by the extension. */
  ts: z.number(),
});

export const browserEventMessageSchema = z.discriminatedUnion("type", [
  browserFocusMessageSchema,
  browserUrlMessageSchema,
]);

export type BrowserFocusMessage = z.infer<typeof browserFocusMessageSchema>;
export type BrowserUrlMessage = z.infer<typeof browserUrlMessageSchema>;
export type BrowserEventMessage = z.infer<typeof browserEventMessageSchema>;

export const createBrowserEventMessage = (message: BrowserEventMessage) => {
  return JSON.stringify(message);
};
