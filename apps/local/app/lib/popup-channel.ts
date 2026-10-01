/**
 * One popup window and the BroadcastChannel that joins it to the main app
 * (same-origin, no server). The diagram playground and the teleprompter are
 * both built on it; each keeps its own message types in its own protocol file
 * and its own channel name, so the two popups never parse each other's traffic.
 *
 * The channel name is also the window name, so `window.open` reuses the popup
 * rather than stacking a second one.
 *
 * Liveness: the popup sends `{ type: "ping" }` every 2s. Every tab that creates
 * the channel records those pings, so a launcher (the sidebar, a button) knows
 * whether the popup is already open. It does not pong — answering is the job
 * of whichever editor is mounted.
 */
import type { z } from "zod";

/** How long after a ping the popup is presumed still there. The popup pings
 * every 2s, so this survives one missed beat. */
export const POPUP_ALIVE_WINDOW_MS = 5000;

/**
 * Whether a ping heard at `pingAt` still means the popup is there. Pure and
 * clock-injected so the window is testable; `0` means nothing has ever pinged.
 */
export function isPingFresh(pingAt: number, now: number): boolean {
  return pingAt > 0 && now - pingAt < POPUP_ALIVE_WINDOW_MS;
}

export interface PopupChannel<ToChild, ToParent> {
  /** Main app → popup. */
  sendToChild(message: ToChild): void;
  /** Popup → main app. */
  sendToParent(message: ToParent): void;
  /** Main-app side. Sees only popup → main app messages. */
  subscribeParent(handler: (message: ToParent) => void): () => void;
  /** Popup side. Sees only main app → popup messages. */
  subscribeChild(handler: (message: ToChild) => void): () => void;
  /**
   * Is the popup there right now? Polled rather than subscribed: liveness
   * expires by the clock, so there is no message to hang an event on when it
   * goes away.
   */
  isOpen(): boolean;
  /**
   * Focus the popup if it is open; otherwise open `url` in it. `url` is used
   * only when a new window opens.
   */
  open(url?: string): Window | null;
}

export function createPopupChannel<
  ToChild,
  ToParent extends { type: string },
>(config: {
  /** BroadcastChannel name, and the popup's window name. */
  name: string;
  /** What `open()` loads when it has to open a new window. */
  url: string;
  /** The `window.open` features string, e.g. "popup,width=1100,height=800". */
  windowFeatures: string;
  toChild: z.ZodType<ToChild>;
  toParent: z.ZodType<ToParent>;
}): PopupChannel<ToChild, ToParent> {
  const { name, url: defaultUrl, windowFeatures, toChild, toParent } = config;

  let sendChannel: BroadcastChannel | null = null;
  const send = (message: ToChild | ToParent) => {
    if (typeof window === "undefined") return;
    if (!sendChannel) sendChannel = new BroadcastChannel(name);
    sendChannel.postMessage(message);
  };

  const subscribe = <T>(
    schema: z.ZodType<T>,
    handler: (message: T) => void
  ): (() => void) => {
    if (typeof window === "undefined") return () => {};
    const ch = new BroadcastChannel(name);
    ch.onmessage = (e) => {
      const result = schema.safeParse(e.data);
      if (result.success) handler(result.data);
    };
    return () => ch.close();
  };

  let lastPingAt = 0;
  let popupRef: Window | null = null;

  subscribe(toParent, (msg) => {
    if (msg.type === "ping") lastPingAt = Date.now();
  });

  const isOpen = (): boolean => {
    if (popupRef && popupRef.closed) {
      popupRef = null;
      lastPingAt = 0;
      return false;
    }
    return isPingFresh(lastPingAt, Date.now());
  };

  return {
    sendToChild: send,
    sendToParent: send,
    subscribeParent: (handler) => subscribe(toParent, handler),
    subscribeChild: (handler) => subscribe(toChild, handler),
    isOpen,
    open(url = defaultUrl) {
      if (isOpen() && popupRef) {
        popupRef.focus();
        return popupRef;
      }
      const w = window.open(url, name, windowFeatures);
      if (w) popupRef = w;
      w?.focus();
      return w;
    },
  };
}
