import { isPingFresh } from "@/lib/popup-channel";
import type { ChatView } from "./chat-view";

/**
 * The pop-out chat window (#2558), a pure view of the Streaming tab's chat:
 * the tab answers each of its pings with the chat as it stands, and pushes
 * every change (`lib/stream-chat-protocol.ts`). It opens no connection to
 * the app server of its own: a browser gives every CVM window six.
 */
export namespace streamChatPopoutReducer {
  export type State = {
    /** The chat as the Streaming tab last sent it; null before it has. */
    view: ChatView | null;
    /** The Streaming tab answered lately. */
    attached: boolean;
    /** When the Streaming tab last sent its chat (ms). */
    heardAt: number;
  };

  export type Action =
    | { type: "chat-view-heard"; view: ChatView; at: number }
    /** The window's clock, each ping. */
    | { type: "ticked"; at: number };
}

type State = streamChatPopoutReducer.State;
type Action = streamChatPopoutReducer.Action;

export const createInitialStreamChatPopoutState = (): State => ({
  view: null,
  attached: false,
  heardAt: 0,
});

export const streamChatPopoutReducer = (
  state: State,
  action: Action
): State => {
  switch (action.type) {
    case "chat-view-heard":
      return { view: action.view, attached: true, heardAt: action.at };
    case "ticked": {
      const attached = isPingFresh(state.heardAt, action.at);
      return attached === state.attached ? state : { ...state, attached };
    }
  }
};
