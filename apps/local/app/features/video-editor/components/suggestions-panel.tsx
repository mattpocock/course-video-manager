import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  CheckGlyph,
  estimateTokens,
  fmtTok,
} from "@/features/article-writer/inline-context-strip";
import {
  AlertCircleIcon,
  CompassIcon,
  Layers,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  getPickedRepoFiles,
  getRepoFilesTokens,
  getSourceTexts,
  getSteerInEffect,
  getSuggestionInput,
  getSuggestionText,
  isPreviousVideoInReach,
  PREVIOUS_VIDEO_CLIP_LIMIT,
  suggestionsReducer,
} from "../suggestions-reducer";
import { SuggestionsContextModal } from "./suggestions-context-modal";

const SOURCE_LABELS: Record<suggestionsReducer.Source, string> = {
  script: "Script",
  animatic: "Animatic",
  beats: "Beats",
  diagram: "Diagram",
  previousVideo: "Previous video",
};

/** Why a source's chip can't be ticked, or `null` when it can. */
const disabledReason = (
  source: suggestionsReducer.Source,
  present: boolean,
  inReach: boolean
): string | null => {
  if (source === "previousVideo" && present && !inReach) {
    return `Off once ${PREVIOUS_VIDEO_CLIP_LIMIT} clips are before the Insertion Point`;
  }
  if (present) return null;
  if (source === "previousVideo") return "No previous video with clips";
  return `This video has no ${SOURCE_LABELS[source]}`;
};

/** The suggestion's Markdown, rendered as bold and nothing else. */
const BOLD_ONLY = ["p", "strong"];

/**
 * The side panel's **Suggestions** tab: which sources go in (with what each
 * one costs, as the Article Writer's context strip shows it), the Steer in
 * effect at the Insertion Point (with a button to give, edit or clear it),
 * and the Suggestion as it streams, which is on the teleprompter while this
 * tab is open. **Context** opens a modal to pick the Video's repo files, which go in
 * too. All state is in `suggestions-reducer.ts`.
 */
export function SuggestionsPanel(props: {
  state: suggestionsReducer.State;
  onToggleSource: (source: suggestionsReducer.Source) => void;
  onRefresh: () => void;
  onSteerClick: () => void;
  onSteerDraftChange: (text: string) => void;
  onSteerSubmit: () => void;
  onSteerDismiss: () => void;
  onSteerClear: () => void;
  onContextClick: () => void;
  onContextDismiss: () => void;
  onFilesPicked: (paths: string[]) => void;
}) {
  const { state } = props;
  const texts = getSourceTexts(state);
  const input = getSuggestionInput(state);
  const text = getSuggestionText(state);
  const steer = getSteerInEffect(state);
  const clipsTokens = estimateTokens(input.clips.join("\n"));
  const pickedFiles = getPickedRepoFiles(state);
  const totalTokens =
    clipsTokens +
    getRepoFilesTokens(pickedFiles) +
    suggestionsReducer.SOURCES.reduce(
      (sum, source) => sum + estimateTokens(input[source] ?? ""),
      0
    );
  const scriptLoading = state.script === null;
  const busy = state.status === "waiting" || state.status === "streaming";
  const previousVideoInReach = isPreviousVideoInReach(state);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
        <button
          type="button"
          onClick={props.onContextClick}
          className="mr-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Pick repo files to send with each suggestion. The number is the estimated tokens sent."
        >
          <Layers className="size-3.5" />
          <span>
            Context
            {pickedFiles.length > 0 ? ` (${pickedFiles.length})` : ""}
          </span>
          <span className="font-mono tabular-nums">{fmtTok(totalTokens)}</span>
        </button>
        {suggestionsReducer.SOURCES.map((source) => {
          const present = texts[source].trim().length > 0;
          const reason = disabledReason(source, present, previousVideoInReach);
          const disabled =
            reason !== null && !(source === "script" && scriptLoading);
          const on = state.included[source] && !disabled && present;
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
                disabled && reason
                  ? reason
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
          title="Every Clip before the Insertion Point, the last few marked as where you are. Always sent."
        >
          <span>Clips {input.clips.length}</span>
          <span className="w-9 text-right font-mono tabular-nums">
            {fmtTok(clipsTokens)}
          </span>
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <SteerBox
          steer={steer?.text}
          draft={state.steerDraft}
          onClick={props.onSteerClick}
          onDraftChange={props.onSteerDraftChange}
          onSubmit={props.onSteerSubmit}
          onDismiss={props.onSteerDismiss}
          onClear={props.onSteerClear}
        />
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
        {state.awaitingRefresh ? (
          <p className="text-sm text-muted-foreground">
            Press Refresh for a suggestion.
          </p>
        ) : state.status === "failed" ? (
          <p className="flex items-start gap-2 text-sm text-red-400">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            The suggestion failed. Refresh to try again.
          </p>
        ) : text ? (
          <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground [&_strong]:font-semibold">
            <ReactMarkdown allowedElements={BOLD_ONLY} unwrapDisallowed>
              {text}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted/50" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted/50" />
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Shown on the teleprompter while this tab is open.
        </p>
      </div>
      <SuggestionsContextModal
        state={state}
        onDismiss={props.onContextDismiss}
        onFilesPicked={props.onFilesPicked}
      />
    </div>
  );
}

/**
 * The Steer at the Insertion Point: a button to give one, or the one in
 * effect with Edit and Clear, or the box it is typed in. Enter submits,
 * Escape closes the box, Shift+Enter breaks the line.
 */
function SteerBox(props: {
  steer: string | undefined;
  draft: string | null;
  onClick: () => void;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  onDismiss: () => void;
  onClear: () => void;
}) {
  if (props.draft !== null) {
    return (
      <form
        className="mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
      >
        <label
          htmlFor="suggestion-steer"
          className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Steer
        </label>
        <textarea
          id="suggestion-steer"
          autoFocus
          value={props.draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              props.onSubmit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              props.onDismiss();
            }
          }}
          placeholder="Where the next clip goes, e.g. “show the error message next”. Used up once a clip is recorded here."
          className="mt-1 field-sizing-content min-h-16 w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="mt-1 flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onDismiss}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Steer
          </Button>
        </div>
      </form>
    );
  }
  if (props.steer !== undefined) {
    return (
      <div className="mb-6 rounded-md border bg-muted/30 px-2 py-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Steer
          </p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={props.onClick}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-6 p-0"
              onClick={props.onClear}
              aria-label="Clear the Steer"
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm">{props.steer}</p>
      </div>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="mb-6 gap-1.5"
      onClick={props.onClick}
      title="Tell the next suggestion where you're going. It applies at this Insertion Point until a clip is recorded here."
    >
      <CompassIcon className="size-3.5" />
      Steer the next suggestion
    </Button>
  );
}
