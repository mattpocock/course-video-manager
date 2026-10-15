import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  CheckGlyph,
  estimateTokens,
  fmtTok,
} from "@/features/article-writer/inline-context-strip";
import { AlertCircleIcon, Layers, RefreshCwIcon } from "lucide-react";
import {
  getSourceTexts,
  getSuggestionInput,
  suggestionsReducer,
} from "../suggestions-reducer";

const SOURCE_LABELS: Record<suggestionsReducer.Source, string> = {
  notes: "Notes",
  script: "Script",
  animatic: "Animatic",
  beats: "Beats",
};

/**
 * The side panel's **Suggestions** tab: which sources go in (with what each
 * one costs, as the Article Writer's context strip shows it), and the next
 * line as it streams. The same line is on the teleprompter while this tab is
 * open. All state is in `suggestions-reducer.ts`.
 */
export function SuggestionsPanel(props: {
  state: suggestionsReducer.State;
  onToggleSource: (source: suggestionsReducer.Source) => void;
  onRefresh: () => void;
  onNotesChange: (notes: string) => void;
}) {
  const { state } = props;
  const texts = getSourceTexts(state);
  const input = getSuggestionInput(state);
  const recentClipsTokens = estimateTokens(input.recentClips.join("\n"));
  const totalTokens =
    recentClipsTokens +
    suggestionsReducer.SOURCES.reduce(
      (sum, source) => sum + estimateTokens(input[source] ?? ""),
      0
    );
  const scriptLoading = state.script === null;
  const busy = state.status === "waiting" || state.status === "streaming";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
        <span
          className="mr-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
          title="Estimated tokens sent with each suggestion"
        >
          <Layers className="size-3.5" />
          <span>Context</span>
          <span className="font-mono tabular-nums">{fmtTok(totalTokens)}</span>
        </span>
        {suggestionsReducer.SOURCES.map((source) => {
          const present = texts[source].trim().length > 0;
          const disabled = !present && !(source === "script" && scriptLoading);
          const on = state.included[source] && present;
          return (
            <button
              key={source}
              type="button"
              aria-pressed={state.included[source]}
              disabled={disabled}
              onClick={() => props.onToggleSource(source)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                disabled
                  ? "cursor-not-allowed opacity-40"
                  : on
                    ? "bg-background hover:bg-muted"
                    : "bg-transparent text-muted-foreground opacity-70"
              )}
              title={
                disabled
                  ? source === "notes"
                    ? "Write some Notes below to include them"
                    : `This video has no ${SOURCE_LABELS[source]}`
                  : `Include the ${SOURCE_LABELS[source]}`
              }
            >
              <CheckGlyph state={on} />
              <span>{SOURCE_LABELS[source]}</span>
              <span className="w-9 text-right font-mono tabular-nums text-muted-foreground">
                {present ? fmtTok(estimateTokens(texts[source])) : "–"}
              </span>
            </button>
          );
        })}
        <span
          className="flex items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground"
          title="Where you are: the most recent Clips before the Insertion Point. Always sent."
        >
          <span>Recent Clips {input.recentClips.length}</span>
          <span className="w-9 text-right font-mono tabular-nums">
            {fmtTok(recentClipsTokens)}
          </span>
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Say next
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0"
            onClick={props.onRefresh}
            disabled={scriptLoading}
            aria-label="Suggest again"
          >
            <RefreshCwIcon className={cn("size-3.5", busy && "animate-spin")} />
          </Button>
        </div>
        {state.status === "failed" ? (
          <p className="flex items-start gap-2 text-sm text-red-400">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            The suggestion failed. Refresh to try again.
          </p>
        ) : state.text ? (
          <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground">
            {state.text}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted/50" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted/50" />
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Shown on the teleprompter while this tab is open.
        </p>
        <label
          htmlFor="suggestion-notes"
          className="mt-6 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Notes
        </label>
        <textarea
          id="suggestion-notes"
          value={state.notes}
          onChange={(e) => props.onNotesChange(e.target.value)}
          placeholder="How this take departs from the Script or Animatic. Overrides them where they disagree. Kept in this browser, for this video only."
          rows={5}
          className="mt-1 w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  );
}
