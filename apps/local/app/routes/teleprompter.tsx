/**
 * The teleprompter window: the current video's Script on an Elgato Prompter,
 * following whatever the Video Editor has open.
 *
 * A top-level flat route (no `_app.` prefix) so it renders bare with no
 * sidebar, exactly like `diagram-playground.*`.
 *
 * There is no videoId in the URL and no picker, by design: the window shows
 * whatever the Video Editor currently has open, learned over BroadcastChannel,
 * and shows an empty state when the editor has nothing. That means no loader —
 * the server doesn't know which video this is until the editor says so.
 *
 * All of the state lives in `teleprompterSession`, so what's left here is
 * plumbing: subscribe, poll, dispatch.
 */
import { useEffect, useMemo, useReducer, useRef } from "react";
import { teleprompterChannel } from "@/lib/teleprompter-protocol";
import { parseScriptBlocks } from "@/features/teleprompter/script-blocks";
import { CaptureIndicator } from "@/features/teleprompter/capture-indicator";
import { TeleprompterCrawl } from "@/features/teleprompter/teleprompter-crawl";
import { teleprompterSession } from "@/features/teleprompter/teleprompter-session";
import { SessionMarks } from "@/features/teleprompter/session-marks";
import { LatestTranscript } from "@/features/teleprompter/latest-transcript";
import { VideoLength } from "@/features/teleprompter/video-length";
import { NO_TOASTS } from "@/lib/route-toasts";
import type { Route } from "./+types/teleprompter";

const PING_INTERVAL_MS = 2000;
const POLL_INTERVAL_MS = 3000;

export const handle = NO_TOASTS;

export const meta: Route.MetaFunction = () => [{ title: "Teleprompter" }];

export default function Teleprompter() {
  const [state, dispatch] = useReducer(
    teleprompterSession.reducer,
    teleprompterSession.initialState
  );
  const { videoId } = state;

  // --- Editor sync: the only way this window learns anything --------------
  // The editor *pushes*; the heartbeat below is liveness only. `hello` goes out
  // alongside the ping while we believe nobody is attached, which covers both
  // join orders (popup first, or editor first) and re-syncs after the editor
  // reloads — and stops the moment we're attached, so a running editor isn't
  // answering questions every two seconds.
  const connectedRef = useRef(false);
  connectedRef.current = state.editorConnected;

  useEffect(() => {
    const unsub = teleprompterChannel.subscribeChild((msg) => {
      if (msg.type === "editorState") {
        dispatch({
          type: "editor-state",
          videoId: msg.videoId,
          capture: msg.capture,
          marks: msg.marks,
          markClipIds: msg.markClipIds,
          playingClipId: msg.playingClipId,
          latestTranscript: msg.latestTranscript,
          videoLengthSeconds: msg.videoLengthSeconds,
          suggestion: msg.suggestion,
          at: Date.now(),
        });
      } else if (msg.type === "pong") {
        // A pong that revives a lapsed connection carries nothing, and the
        // lapse wiped the marks, transcript and length — so ask again, or they
        // stay blank until something in the editor happens to change.
        if (!connectedRef.current)
          teleprompterChannel.sendToParent({ type: "hello" });
        dispatch({ type: "editor-alive", at: Date.now() });
      } else if (msg.type === "editorDisconnected") {
        dispatch({ type: "editor-disconnected" });
      } else if (msg.type === "contentChanged") {
        refetch.current();
      } else if (msg.type === "scriptChanged") {
        dispatch({
          type: "script-pushed",
          videoId: msg.videoId,
          script: msg.script,
          at: Date.now(),
        });
      }
    });

    const knock = () => {
      teleprompterChannel.sendToParent({ type: "ping" });
      if (!connectedRef.current)
        teleprompterChannel.sendToParent({ type: "hello" });
    };

    knock();
    const beat = setInterval(() => {
      knock();
      dispatch({ type: "liveness-checked", at: Date.now() });
    }, PING_INTERVAL_MS);

    return () => {
      clearInterval(beat);
      unsub();
    };
  }, []);

  // --- Content polling -----------------------------------------------------
  // A plain fetch rather than a loader revalidation, so a poll that returns
  // identical text doesn't re-render and reset reading position mid-take.
  const refetch = useRef<() => void>(() => {});
  useEffect(() => {
    if (!videoId) {
      refetch.current = () => {};
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/teleprompter/${videoId}/content`);
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as teleprompterSession.Content;
        if (cancelled) return;
        dispatch({
          type: "content-fetched",
          videoId,
          content: json,
          at: Date.now(),
        });
      } catch {
        // Dev server restarting — the next tick picks it up.
      }
    };

    refetch.current = load;
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [videoId]);

  const glassScript = teleprompterSession.glassScript(state);
  const blocks = useMemo(() => parseScriptBlocks(glassScript), [glassScript]);

  const emptyMessage = !state.editorConnected
    ? "Waiting for a Video Editor window."
    : !videoId
      ? "No video open in the editor."
      : state.suggestion !== null
        ? "Thinking of what to say next…"
        : "This video has no Script yet.";

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black">
      <CaptureIndicator
        status={state.capture}
        editorConnected={state.editorConnected}
      />

      {state.editorConnected && (
        <VideoLength seconds={state.videoLengthSeconds} />
      )}

      {/*
        Always mounted: with no session under way it draws nothing at all, so
        the glass is unchanged until you press record.
      */}
      {state.editorConnected && (
        <SessionMarks
          marks={state.marks}
          clipIds={state.markClipIds}
          playingClipId={state.playingClipId}
          // The editor decides play or pause, and the answer comes back as
          // `playingClipId` on its next push: the glass holds no opinion.
          onMarkClicked={(clipId) =>
            teleprompterChannel.sendToParent({
              type: "clipMarkClicked",
              clipId,
            })
          }
        />
      )}

      {state.editorConnected && (
        <LatestTranscript text={state.latestTranscript} />
      )}

      {blocks.length === 0 ? (
        <div className="flex h-full items-center justify-center px-12 text-center">
          <p className="max-w-md text-white/35">{emptyMessage}</p>
        </div>
      ) : (
        // Keyed so a suggestion starts at the top rather than at wherever the
        // Script was scrolled to.
        <TeleprompterCrawl
          key={state.suggestion !== null ? "suggestion" : "script"}
          blocks={blocks}
        />
      )}
    </div>
  );
}
