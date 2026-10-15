/**
 * Is a teleprompter popup attached to this editor? See `usePopupOpen`.
 */
import { teleprompterChannel } from "@/lib/teleprompter-protocol";
import { usePopupOpen } from "./use-popup-open";

export function useTeleprompterConnected(): boolean {
  return usePopupOpen(teleprompterChannel);
}
