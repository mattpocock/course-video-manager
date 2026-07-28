import { useCallback, useLayoutEffect, useRef } from "react";
import type { DocumentAgentMessage } from "./types";

/**
 * Rewrite the text parts of one message, leaving every other message — and
 * every non-text part of the addressed message — exactly as it was.
 */
function rewriteMessageText(
  messages: DocumentAgentMessage[],
  messageId: string,
  rewrite: (text: string) => string
): DocumentAgentMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    return {
      ...message,
      parts: message.parts.map((part) =>
        part.type === "text" ? { ...part, text: rewrite(part.text) } : part
      ),
    };
  });
}

/**
 * Applies text mutations to the newest message list rather than to the list a
 * caller closed over.
 *
 * Capturing a screenshot awaits an HTTP round-trip before it rewrites the
 * message that hosts the `<ChooseScreenshot>` tag. Whatever landed during that
 * await — a message the user submitted, a second capture that resolved first —
 * lives in a newer list than the click's closure holds, so writing that closure
 * back would drop it. Removing a screenshot with the X button never lost
 * anything because it is synchronous; rebasing makes capture behave the same.
 */
export function createMessageTextMutator(messages: DocumentAgentMessage[]) {
  let latest = messages;
  return {
    /** Feed in the newest messages, as rendered. */
    sync(next: DocumentAgentMessage[]) {
      latest = next;
    },
    /**
     * Rebase the mutation onto the newest messages and return the result. The
     * result becomes the new baseline, so mutations that resolve back to back —
     * before React has re-rendered with the first one — compose instead of
     * overwriting each other.
     */
    mutate(messageId: string, rewrite: (text: string) => string) {
      latest = rewriteMessageText(latest, messageId, rewrite);
      return latest;
    },
  };
}

/**
 * Wires {@link createMessageTextMutator} to a component's render loop: each
 * committed change to `messages` becomes the new baseline, and each mutation
 * hands the rebased list back through `onMutated`.
 */
export function useMessageTextMutation(
  messages: DocumentAgentMessage[],
  onMutated: (messages: DocumentAgentMessage[]) => void
) {
  const mutatorRef = useRef<ReturnType<typeof createMessageTextMutator>>(null);
  mutatorRef.current ??= createMessageTextMutator(messages);

  const onMutatedRef = useRef(onMutated);
  onMutatedRef.current = onMutated;

  // Keyed on `messages`, so a re-render caused by unrelated local state — a
  // keystroke in the composer — cannot rewind the baseline to a list that
  // predates a capture React has not handed back down yet. Layout rather than
  // passive, so no capture can resolve into the gap between commit and sync.
  useLayoutEffect(() => {
    mutatorRef.current!.sync(messages);
  }, [messages]);

  return useCallback((messageId: string, rewrite: (text: string) => string) => {
    onMutatedRef.current(mutatorRef.current!.mutate(messageId, rewrite));
  }, []);
}
