/**
 * The only chrome on the glass: which document to show, how fast it rolls, and
 * whether the editor is still talking to us.
 *
 * Sits at the bottom and stays dim until pointed at, because this window spends
 * its life reflected in front of a lens — anything bright is something you'll be
 * reading around for the whole take.
 */
import { Minus, Plus } from "lucide-react";
import {
  MAX_WPM,
  MIN_WPM,
  SOURCES,
  type TeleprompterSettings,
} from "./teleprompter-settings";

const WPM_STEP = 10;

export function TeleprompterControls(props: {
  settings: TeleprompterSettings;
  onChange: <K extends keyof TeleprompterSettings>(
    key: K,
    value: TeleprompterSettings[K]
  ) => void;
  /** Editor connection state, shown so you never wonder if it's stuck. */
  status: string;
}) {
  const { settings, onChange } = props;

  const setWpm = (wpm: number) =>
    onChange("wpm", Math.min(MAX_WPM, Math.max(MIN_WPM, wpm)));

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 opacity-25 transition-opacity duration-200 hover:opacity-100">
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-neutral-950/90 px-2 py-1.5 backdrop-blur">
        <div className="flex overflow-hidden rounded-full bg-white/5">
          {SOURCES.map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => onChange("source", source)}
              className={`px-3 py-1 text-xs capitalize transition-colors ${
                settings.source === source
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {source}
            </button>
          ))}
        </div>

        {settings.source === "script" && (
          <>
            <span className="mx-1 h-4 w-px bg-white/10" />
            <button
              type="button"
              onClick={() => setWpm(settings.wpm - WPM_STEP)}
              className="rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Slower"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-16 text-center text-xs tabular-nums text-white/70">
              {settings.wpm} wpm
            </span>
            <button
              type="button"
              onClick={() => setWpm(settings.wpm + WPM_STEP)}
              className="rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Faster"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        <span className="mx-1 h-4 w-px bg-white/10" />
        <span className="px-1 text-[11px] text-white/40">{props.status}</span>
      </div>
    </div>
  );
}
