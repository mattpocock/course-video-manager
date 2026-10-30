import { createContext, useContext, useMemo } from "react";
import type { liveStreamReducer } from "./live-stream-reducer";
import { useLiveStreamReducer } from "./use-live-stream-reducer";

type LiveStreamContextType = {
  state: liveStreamReducer.State;
  dispatch: (action: liveStreamReducer.Action) => void;
};

const LiveStreamContext = createContext<LiveStreamContextType>(null!);

/**
 * The app-wide Live Stream surface, mounted at the app root so the picked
 * Broadcast (and, later, the Live Stream itself) outlives the Streaming tab.
 */
export function LiveStreamProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useLiveStreamReducer();
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return (
    <LiveStreamContext.Provider value={value}>
      {children}
    </LiveStreamContext.Provider>
  );
}

export const useLiveStream = () => useContext(LiveStreamContext);
