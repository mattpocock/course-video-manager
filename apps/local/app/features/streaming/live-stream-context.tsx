import { createContext, useContext, useEffect, useMemo } from "react";
import type { liveStreamReducer } from "./live-stream-reducer";
import { useLiveStreamReducer } from "./use-live-stream-reducer";
import { subscribeToLiveStream } from "./live-stream-wire";

type LiveStreamContextType = {
  state: liveStreamReducer.State;
  dispatch: (action: liveStreamReducer.Action) => void;
};

const LiveStreamContext = createContext<LiveStreamContextType>(null!);

/**
 * The app-wide Live Stream surface, mounted at the app root so the picked
 * Broadcast and the Live Stream outlive the Streaming tab. It hears the app
 * server's word on the Live Stream from the tab's app-wide stream.
 */
export function LiveStreamProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useLiveStreamReducer();
  // Bridges the app server's word on the Live Stream in, as it changes.
  useEffect(
    () =>
      subscribeToLiveStream((stream) =>
        dispatch({ type: "live-stream-heard", stream })
      ),
    [dispatch]
  );
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return (
    <LiveStreamContext.Provider value={value}>
      {children}
    </LiveStreamContext.Provider>
  );
}

export const useLiveStream = () => useContext(LiveStreamContext);
