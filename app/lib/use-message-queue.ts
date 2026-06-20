import { useCallback, useEffect, useRef, useState } from "react";

export type ChatStatus = "streaming" | "submitted" | "ready" | "error";

export function processSubmit(
  status: ChatStatus,
  text: string,
  currentQueue: string[]
): { queued: string[]; sent: string | null } {
  if (status === "streaming" || status === "submitted") {
    return { queued: [...currentQueue, text], sent: null };
  }
  return { queued: currentQueue, sent: text };
}

export function drainQueue(
  status: ChatStatus,
  queue: string[]
): { nextQueue: string[]; messageToSend: string | null } {
  if (status === "ready" && queue.length > 0) {
    return { nextQueue: queue.slice(1), messageToSend: queue[0]! };
  }
  return { nextQueue: queue, messageToSend: null };
}

export function useMessageQueue(
  status: ChatStatus,
  onSend: (text: string) => void
) {
  const [queue, setQueue] = useState<string[]>([]);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const submit = useCallback(
    (text: string) => {
      if (status === "streaming" || status === "submitted") {
        setQueue((prev) => [...prev, text]);
      } else {
        onSendRef.current(text);
      }
    },
    [status]
  );

  const clearQueue = useCallback(() => setQueue([]), []);

  useEffect(() => {
    const result = drainQueue(status, queue);
    if (result.messageToSend !== null) {
      setQueue(result.nextQueue);
      onSendRef.current(result.messageToSend);
    }
  }, [status, queue]);

  return { submit, queuedMessages: queue, clearQueue };
}
