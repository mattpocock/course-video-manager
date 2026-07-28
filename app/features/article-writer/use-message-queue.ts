import { useCallback, useEffect, useRef, useState } from "react";

export type ChatStatus = "streaming" | "submitted" | "ready" | "error";

/**
 * A send has to wait while a response is in flight — and while a screenshot
 * capture is, because the capture rewrites the document the send would carry.
 * Sending first would hand the model the `<ChooseScreenshot>` placeholder and
 * lose the captured image when its rewrite lands.
 *
 * A capture only earns a hold from a status the queue can drain back out of.
 * `drainQueue` releases on "ready" alone, so holding a send made while the last
 * response errored would strand it: the capture landing does not move an
 * errored chat back to "ready", and nothing else would release it.
 */
function shouldHold(status: ChatStatus, isCapturing: boolean): boolean {
  if (status === "streaming" || status === "submitted") return true;
  return isCapturing && status === "ready";
}

export function processSubmit(
  status: ChatStatus,
  text: string,
  currentQueue: string[],
  isCapturing: boolean
): { queued: string[]; sent: string | null } {
  if (shouldHold(status, isCapturing)) {
    return { queued: [...currentQueue, text], sent: null };
  }
  return { queued: currentQueue, sent: text };
}

export function drainQueue(
  status: ChatStatus,
  queue: string[],
  isCapturing: boolean
): { nextQueue: string[]; messageToSend: string | null } {
  if (!isCapturing && status === "ready" && queue.length > 0) {
    return { nextQueue: queue.slice(1), messageToSend: queue[0]! };
  }
  return { nextQueue: queue, messageToSend: null };
}

export function useMessageQueue(
  status: ChatStatus,
  onSend: (text: string) => void,
  isCapturing: boolean
) {
  const [queue, setQueue] = useState<string[]>([]);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const submit = useCallback(
    (text: string) => {
      if (shouldHold(status, isCapturing)) {
        setQueue((prev) => [...prev, text]);
      } else {
        onSendRef.current(text);
      }
    },
    [status, isCapturing]
  );

  const clearQueue = useCallback(() => setQueue([]), []);

  useEffect(() => {
    const result = drainQueue(status, queue, isCapturing);
    if (result.messageToSend !== null) {
      setQueue(result.nextQueue);
      onSendRef.current(result.messageToSend);
    }
  }, [status, queue, isCapturing]);

  return { submit, queuedMessages: queue, clearQueue };
}
