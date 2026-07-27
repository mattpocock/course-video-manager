/**
 * PROTOTYPE — throwaway. See app/features/teleprompter-prototype/README.md.
 *
 * The teleprompter popup. A top-level flat route (no `_app.` prefix) so it
 * renders bare with no sidebar, exactly like `diagram-playground.*`.
 *
 * There is no videoId in the URL and no picker, by design: the window shows
 * whatever the Video Editor currently has open, learned over BroadcastChannel,
 * and shows an empty state when the editor has nothing. That means no loader —
 * the server doesn't know which video this is until the editor says so.
 *
 * Two things are under evaluation, and they're separable:
 *   1. Beats or Script on the glass  → the visible tab (?source=)
 *   2. Which reading model for prose → ?variant=A|B|C
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  subscribeTeleprompterChild,
  sendToEditor,
  type CaptureStatus,
} from "@/lib/teleprompter-prototype-protocol";
import {
  parseScriptBlocks,
  splitIntoSteps,
} from "@/features/teleprompter-prototype/script-blocks";
import { CaptureIndicator } from "@/features/teleprompter-prototype/capture-indicator";
import { PrototypeSwitcher } from "@/features/teleprompter-prototype/prototype-switcher";
import {
  useTeleprompterSettings,
  type PrototypeSettings,
} from "@/features/teleprompter-prototype/prototype-settings";
import {
  BeatsView,
  type TeleprompterBeat,
} from "@/features/teleprompter-prototype/beats-view";
import { VariantCrawl } from "@/features/teleprompter-prototype/variant-crawl";
import { VariantStepper } from "@/features/teleprompter-prototype/variant-stepper";
import { VariantBand } from "@/features/teleprompter-prototype/variant-band";
import type { Route } from "./+types/teleprompter-prototype";

const PING_INTERVAL_MS = 2000;
const POLL_INTERVAL_MS = 3000;
const EDITOR_ALIVE_MS = 5000;

export const meta: Route.MetaFunction = () => [
  { title: "Teleprompter (prototype)" },
];

type Content = {
  title: string;
  script: string;
  beats: TeleprompterBeat[];
};

const EMPTY_CONTENT: Content = { title: "", script: "", beats: [] };

export default function TeleprompterPrototype() {
  const [settings, updateSetting] = useTeleprompterSettings();

  const [videoId, setVideoId] = useState<string | null>(null);
  const [editorConnected, setEditorConnected] = useState(false);
  const [capture, setCapture] = useState<CaptureStatus>("not-recording");
  const [content, setContent] = useState<Content>(EMPTY_CONTENT);

  // --- Editor sync: the only way this window learns anything --------------
  const lastPongAt = useRef(0);

  useEffect(() => {
    const unsub = subscribeTeleprompterChild((msg) => {
      if (msg.type === "pong" || msg.type === "editorConnected") {
        lastPongAt.current = Date.now();
        setEditorConnected(true);
        setCapture(msg.capture);
        setVideoId((prev) => (prev === msg.videoId ? prev : msg.videoId));
      } else if (msg.type === "editorDisconnected") {
        lastPongAt.current = 0;
        setEditorConnected(false);
        setCapture("not-recording");
        setVideoId(null);
      } else if (msg.type === "contentChanged") {
        refetch.current();
      }
    });

    sendToEditor({ type: "ping" });
    const beat = setInterval(() => {
      sendToEditor({ type: "ping" });
      if (Date.now() - lastPongAt.current > EDITOR_ALIVE_MS) {
        setEditorConnected(false);
        setCapture("not-recording");
      }
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
      setContent(EMPTY_CONTENT);
      refetch.current = () => {};
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/teleprompter-prototype/${videoId}/content`
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as Content;
        if (cancelled) return;
        setContent((prev) =>
          prev.title === json.title &&
          prev.script === json.script &&
          JSON.stringify(prev.beats) === JSON.stringify(json.beats)
            ? prev
            : json
        );
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
  const steps = useMemo(() => splitIntoSteps(blocks), [blocks]);

  // --- Source: script wins, unless you've said otherwise for this video ------
  // A video with a written script should land on the script; only a video
  // without one falls back to the beat plan. Choosing the tab by hand pins it,
  // and moving to another video un-pins it so the new video decides again.
  const sourcePinned = useRef(false);
  useEffect(() => {
    sourcePinned.current = false;
  }, [videoId]);

  const changeSetting = useCallback(
    <K extends keyof PrototypeSettings>(
      key: K,
      value: PrototypeSettings[K]
    ) => {
      if (key === "source") sourcePinned.current = true;
      updateSetting(key, value);
    },
    [updateSetting]
  );

  useEffect(() => {
    if (sourcePinned.current) return;
    const wanted = blocks.length
      ? "script"
      : content.beats.length
        ? "beats"
        : null;
    if (wanted && wanted !== settings.source) updateSetting("source", wanted);
  }, [blocks.length, content.beats.length, settings.source, updateSetting]);

  const status = editorConnected
    ? videoId
      ? "following editor"
      : "editor connected · no video"
    : "editor not connected";

  const emptyMessage = !editorConnected
    ? "Waiting for a Video Editor window."
    : !videoId
      ? "No video open in the editor."
      : settings.source === "beats"
        ? "This video has no Beats yet."
        : "This video has no Script yet.";

  const hasContent =
    settings.source === "beats" ? content.beats.length > 0 : blocks.length > 0;

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black">
      <CaptureIndicator status={capture} editorConnected={editorConnected} />

      {content.title && (
        <div className="pointer-events-none absolute left-24 top-9 z-40 truncate pr-24 text-xs text-white/25">
          {content.title}
        </div>
      )}

      {!hasContent ? (
        <div className="flex h-full items-center justify-center px-12 text-center">
          <p className="max-w-md text-white/35">{emptyMessage}</p>
        </div>
      ) : settings.source === "beats" ? (
        <BeatsView beats={content.beats} settings={settings} />
      ) : settings.variant === "A" ? (
        <VariantCrawl blocks={blocks} settings={settings} />
      ) : settings.variant === "B" ? (
        <VariantStepper steps={steps} settings={settings} />
      ) : (
        <VariantBand blocks={blocks} settings={settings} />
      )}

      <PrototypeSwitcher
        settings={settings}
        onChange={changeSetting}
        status={status}
      />
    </div>
  );
}
