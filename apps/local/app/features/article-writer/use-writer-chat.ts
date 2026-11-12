import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialWriterChatState,
  loadEffect,
  writerChatReducer,
} from "./writer-chat-reducer";
import { loadWriterChats, saveWriterChat } from "./writer-chat-requests";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed";

/**
 * The effect runner for `writerChatReducer`. `showMessages` puts a loaded
 * chat into the writer's `useChat`. Mount it once per Video and field (the
 * writer is remounted for another Video).
 */
export function useWriterChat(opts: {
  videoId: string;
  fieldId: string;
  mode: string;
  showMessages: (messages: unknown[]) => void;
}) {
  const { showMessages } = opts;
  const [state, dispatch] = useEffectReducer<
    writerChatReducer.State,
    writerChatReducer.Action,
    writerChatReducer.Effect
  >(
    writerChatReducer,
    (exec) => {
      const initial = createInitialWriterChatState(opts);
      exec(loadEffect(initial));
      return initial;
    },
    {
      "load-writer-chats": (_state, effect, dispatch) => {
        let cancelled = false;
        loadWriterChats(effect.videoId, effect.fieldId)
          .then((chats) => {
            if (!cancelled) dispatch({ type: "writer-chats-loaded", chats });
          })
          .catch((error: unknown) => {
            if (!cancelled) {
              dispatch({
                type: "writer-chats-load-failed",
                message: messageOf(error),
              });
            }
          });
        return () => {
          cancelled = true;
        };
      },
      "show-messages": (_state, effect) => {
        showMessages(effect.messages);
      },
      "save-writer-chat": (_state, effect, dispatch) => {
        saveWriterChat(effect)
          .then(() => dispatch({ type: "writer-chat-saved" }))
          .catch((error: unknown) =>
            dispatch({
              type: "writer-chat-save-failed",
              mode: effect.mode,
              messages: effect.messages,
              message: messageOf(error),
            })
          );
      },
    }
  );

  return { state, dispatch };
}
