/**
 * The teleprompter window: the current video's Script (or Beat plan) on an
 * Elgato Prompter, following whatever the Video Editor has open.
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
import {
  subscribeTeleprompterChild,
  sendToEditor,
} from "@/lib/teleprompter-protocol";
import { parseScriptBlocks } from "@/features/teleprompter/script-blocks";
import { CaptureIndicator } from "@/features/teleprompter/capture-indicator";
import { TeleprompterControls } from "@/features/teleprompter/teleprompter-controls";
import { useTeleprompterWpm } from "@/features/teleprompter/teleprompter-settings";
import { BeatsView } from "@/features/teleprompter/beats-view";
import { TeleprompterCrawl } from "@/features/teleprompter/teleprompter-crawl";
import { teleprompterSession } from "@/features/teleprompter/teleprompter-session";
import { SessionMarksDisplay } from "@/features/teleprompter/prototype-session-marks-display";
import { PrototypeControls } from "@/features/teleprompter/prototype-controls";
import type { Route } from "./+types/teleprompter";

const PING_INTERVAL_MS = 2000;
const POLL_INTERVAL_MS = 3000;

export const meta: Route.MetaFunction = () => [{ title: "Teleprompter" }];

export default function Teleprompter() {
  const [wpm, setWpm] = useTeleprompterWpm();
  const [state, dispatch] = useReducer(
    teleprompterSession.reducer,
    teleprompterSession.initialState
  );
  const { videoId, content } = state;

  // --- Editor sync: the only way this window learns anything --------------
  // The editor *pushes*; the heartbeat below is liveness only. `hello` goes out
  // alongside the ping while we believe nobody is attached, which covers both
  // join orders (popup first, or editor first) and re-syncs after the editor
  // reloads — and stops the moment we're attached, so a running editor isn't
  // answering questions every two seconds.
  const connectedRef = useRef(false);
  connectedRef.current = state.editorConnected;

  useEffect(() => {
    const unsub = subscribeTeleprompterChild((msg) => {
      if (msg.type === "editorState") {
        dispatch({
          type: "editor-state",
          videoId: msg.videoId,
          capture: msg.capture,
          tab: msg.tab,
          marks: msg.marks,
          at: Date.now(),
        });
      } else if (msg.type === "pong") {
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
      sendToEditor({ type: "ping" });
      if (!connectedRef.current) sendToEditor({ type: "hello" });
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

  const blocks = useMemo(
    () => parseScriptBlocks(content.script),
    [content.script]
  );

  const source = teleprompterSession.resolveSource(state, {
    hasScript: blocks.length > 0,
    hasBeats: content.beats.length > 0,
  });

  const status = state.editorConnected
    ? videoId
      ? "following editor"
      : "editor connected · no video"
    : "editor not connected";

  const emptyMessage = !state.editorConnected
    ? "Waiting for a Video Editor window."
    : !videoId
      ? "No video open in the editor."
      : source === "beats"
        ? "This video has no Beats yet."
        : "This video has no Script yet.";

  const hasContent =
    source === "beats" ? content.beats.length > 0 : blocks.length > 0;

  // PROTOTYPE — session-clip dots. Always on: with no session under way it
  // draws nothing at all, so the glass is unchanged until you press record.

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black">
      <CaptureIndicator
        status={state.capture}
        editorConnected={state.editorConnected}
      />

      {state.editorConnected && <SessionMarksDisplay marks={state.marks} />}

      {!hasContent ? (
        <div className="flex h-full items-center justify-center px-12 text-center">
          <p className="max-w-md text-white/35">{emptyMessage}</p>
        </div>
      ) : source === "beats" ? (
        <BeatsView beats={content.beats} />
      ) : (
        <TeleprompterCrawl
          blocks={blocks}
          wpm={wpm}
          playing={state.playing}
          onTogglePlay={() => dispatch({ type: "toggle-play" })}
          onRewind={() => dispatch({ type: "rewound" })}
        />
      )}

      <TeleprompterControls
        source={source}
        onSourceChange={(next) =>
          dispatch({ type: "source-picked", source: next })
        }
        wpm={wpm}
        onWpmChange={setWpm}
        status={status}
      />

      <PrototypeControls marks={state.marks} />
    </div>
  );
}
