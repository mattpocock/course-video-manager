import { Captions } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The CC control on the Animatic's stage. C does the same, as on YouTube.
 *
 * The stored choice can differ from what the server drew, hence the hydration
 * warning suppressed here.
 */
export const AnimaticSubtitlesToggle = (props: {
  showSubtitles: boolean;
  onToggle: () => void;
}) => (
  <button
    type="button"
    suppressHydrationWarning
    className={cn(
      "allow-keydown rounded-md bg-black/70 p-1.5 hover:bg-black/90",
      props.showSubtitles ? "text-white" : "text-white/40"
    )}
    onClick={props.onToggle}
    aria-pressed={props.showSubtitles}
    aria-label={props.showSubtitles ? "Hide subtitles" : "Show subtitles"}
    title={props.showSubtitles ? "Hide subtitles (C)" : "Show subtitles (C)"}
  >
    <Captions className="size-5" />
  </button>
);
