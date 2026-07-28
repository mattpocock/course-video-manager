import { useCallback, useEffect, useRef, useState } from "react";

export type ChatStatus = "streaming" | "submitted" | "ready" | "error";

/**
 * A send has to wait while a response is in flight — and while a screenshot
 * capture is, because the capture rewrites the document the send would carry.
 * Sending first would hand the model the `<ChooseScreenshot>` placeholder and
 * lose the captured image when its rewrite lands.
 */
export function shouldHold(status: ChatStatus, isCapturing: boolean): boolean {
  return isCapturing || status === "streaming" || status === "submitted";
}

export function processSubmit(
  status: ChatStatus,
  text: string,
  currentQueue: string[],
  isCapturing = false
): { queued: string[]; sent: string | null } {
  if (shouldHold(status, isCapturing)) {
    return { queued: [...currentQueue, text], sent: null };
  }
  return { queued: currentQueue, sent: text };
}

export function drainQueue(
  status: ChatStatus,
  queue: string[],
  isCapturing = false
): { nextQueue: string[]; messageToSend: string | null } {
  if (!isCapturing && status === "ready" && queue.length > 0) {
    return { nextQueue: queue.slice(1), messageToSend: queue[0]! };
  }
  return { nextQueue: queue, messageToSend: null };
}

export function useMessageQueue(
  status: ChatStatus,
  onSend: (text: string) => void,
  isCapturing = false
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
