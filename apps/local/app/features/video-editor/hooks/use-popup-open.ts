/**
 * Is a popup (the teleprompter, the diagram playground) open right now?
 *
 * Every `PopupChannel` already records its popup's pings for every tab that
 * imports it; this turns that into a value React renders from. Polled on a tick
 * rather than subscribed because liveness *expires*: a closed popup sends no
 * message, it just stops pinging.
 *
 * The tick is a second, an order of magnitude finer than the 5s window and well
 * under the delay you'd notice when opening a popup. `useSyncExternalStore`
 * compares the boolean, so a component re-renders on the transitions rather
 * than once a second.
 */
import { useSyncExternalStore } from "react";
import type { PopupChannel } from "@/lib/popup-channel";

type Liveness = Pick<PopupChannel<unknown, { type: string }>, "isOpen">;

const POLL_INTERVAL_MS = 1000;

function subscribeToTick(onTick: () => void): () => void {
  const id = setInterval(onTick, POLL_INTERVAL_MS);
  return () => clearInterval(id);
}

export function usePopupOpen(channel: Liveness): boolean {
  return useSyncExternalStore(
    subscribeToTick,
    () => channel.isOpen(),
    () => false
  );
}
