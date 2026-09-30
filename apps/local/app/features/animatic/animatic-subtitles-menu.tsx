import { Captions } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ANIMATIC_SUBTITLE_STYLE_RANGES,
  DEFAULT_ANIMATIC_SUBTITLE_STYLE,
  type AnimaticSubtitleStyle,
} from "./animatic-subtitles";

/**
 * The CC control on the Animatic's stage. A click opens the subtitle menu —
 * on or off, and the style: how far up or down, how big, how wide. C still
 * turns them on and off without opening it, as on YouTube.
 *
 * Every change shows on the frame at once, so the author drags a slider while
 * he watches the subtitle move off the part of the frame he is judging.
 *
 * The stored choice can differ from what the server drew, hence the hydration
 * warning suppressed on the button.
 */
export const AnimaticSubtitlesMenu = (props: {
  showSubtitles: boolean;
  onShowSubtitles: (on: boolean) => void;
  style: AnimaticSubtitleStyle;
  onStyle: (next: AnimaticSubtitleStyle) => void;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        type="button"
        suppressHydrationWarning
        className={cn(
          "allow-keydown rounded-md bg-black/70 p-1.5 hover:bg-black/90",
          props.showSubtitles ? "text-white" : "text-white/40"
        )}
        aria-label="Subtitle settings"
        title="Subtitle settings (C turns them on and off)"
      >
        <Captions className="size-5" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox
          checked={props.showSubtitles}
          onCheckedChange={(checked) => props.onShowSubtitles(checked === true)}
        />
        Show subtitles
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          C
        </span>
      </label>

      <StyleSlider label="Up / down" unit="px" setting="offsetY" {...props} />
      <StyleSlider label="Size" unit="px" setting="fontSize" {...props} />
      <StyleSlider
        label="Max width"
        unit="ch"
        setting="maxWidthCh"
        {...props}
      />

      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={() => props.onStyle(DEFAULT_ANIMATIC_SUBTITLE_STYLE)}
      >
        Reset to defaults
      </button>
    </PopoverContent>
  </Popover>
);

const StyleSlider = (props: {
  label: string;
  unit: string;
  setting: keyof AnimaticSubtitleStyle;
  style: AnimaticSubtitleStyle;
  onStyle: (next: AnimaticSubtitleStyle) => void;
}) => {
  const { min, max, step } = ANIMATIC_SUBTITLE_STYLE_RANGES[props.setting];
  const value = props.style[props.setting];
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="flex items-baseline justify-between">
        <span className="font-medium">{props.label}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {value > 0 && props.setting === "offsetY" ? "+" : ""}
          {value}
          {props.unit}
        </span>
      </span>
      <input
        type="range"
        className="w-full accent-sky-500"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) =>
          props.onStyle({
            ...props.style,
            [props.setting]: Number(e.target.value),
          })
        }
      />
    </label>
  );
};
