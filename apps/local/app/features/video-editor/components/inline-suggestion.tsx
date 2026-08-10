import {
  AlertCircleIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { Button } from "@/components/ui/button";

/**
 * Inline suggestion display that appears at the bottom of the clip timeline.
 * Shows the AI-generated suggestion for what to say next, styled as plain text
 * for teleprompter-like reading.
 *
 * Includes the refresh button co-located with the suggestion text.
 * Always reserves space when enabled to prevent layout shift.
 */
export const InlineSuggestion = () => {
  const suggestionState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.suggestionState
  );
  const { suggestionText, isStreaming, enabled, error, triggerSuggestion } =
    suggestionState;

  // Only show when suggestions are enabled
  if (!enabled) return null;

  const hasContent = suggestionText || isStreaming;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 min-h-[72px]">
      {error ? (
        <div className="flex items-start gap-3">
          <AlertCircleIcon className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-400">
              Failed to generate suggestion. Click refresh to try again.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={triggerSuggestion}
            className="h-6 w-6 p-0 flex-shrink-0"
          >
            <RefreshCwIcon className="h-4 w-4" />
          </Button>
        </div>
      ) : hasContent ? (
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            {isStreaming ? (
              <Loader2Icon className="h-4 w-4 text-muted-foreground animate-spin" />
            ) : (
              <SparklesIcon className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Say next:
            </p>
            {suggestionText ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                {suggestionText}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="h-4 bg-muted/50 rounded animate-pulse w-3/4" />
                <div className="h-4 bg-muted/50 rounded animate-pulse w-1/2" />
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={triggerSuggestion}
            disabled={isStreaming}
            className="h-6 w-6 p-0 flex-shrink-0"
          >
            <RefreshCwIcon
              className={`h-4 w-4 ${isStreaming ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-muted-foreground">
          <SparklesIcon className="h-4 w-4 flex-shrink-0" />
          <p className="flex-1 text-sm">
            Click refresh to generate a suggestion for what to say next
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={triggerSuggestion}
            className="h-6 w-6 p-0 flex-shrink-0"
          >
            <RefreshCwIcon className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};
