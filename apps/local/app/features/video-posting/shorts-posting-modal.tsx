"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  LinkIcon,
  ListPlusIcon,
  Loader2Icon,
  SparklesIcon,
} from "lucide-react";
import {
  selectCanAdd,
  selectDescriptionRequest,
  selectMetadataProblem,
} from "./shorts-posting-reducer";
import { useShortsPostingReducer } from "./use-shorts-posting-reducer";

/**
 * Add to Posting Queue (#2617): the Short goes in the Posting Queue the way
 * `cvm short post` puts it there, and the Sidecar posts it at its Posting
 * Slot, to YouTube and to TikTok through Buffer.
 */
export function ShortsPostingModal({
  open,
  onOpenChange,
  onQueued,
  videoId,
  videoTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Short went in the Posting Queue. */
  onQueued?: (videoId: string) => void;
  videoId: string;
  videoTitle: string;
}) {
  const { state, dispatch } = useShortsPostingReducer({
    open,
    onOpenChange,
    onQueued,
    videoId,
    videoTitle,
  });

  const { title, description, postedStatus, verdict } = state;
  const metadataProblem = selectMetadataProblem(state);
  const isLoading = state.savedDescription === null;
  const isGeneratingDescription = state.fields.generating !== null;
  const isConvertingShortLinks = state.convertingShortLinks !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to Posting Queue</DialogTitle>
          <DialogDescription>
            At its Posting Slot, CVM posts this Short to YouTube Shorts and to
            TikTok (through Buffer), exporting it first if its export is missing
            or out of date.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {postedStatus && (postedStatus.youtube || postedStatus.tiktok) && (
            <div className="flex gap-2 text-xs text-muted-foreground">
              {postedStatus.youtube && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                  Posted to YouTube
                </span>
              )}
              {postedStatus.tiktok && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                  Posted to TikTok
                </span>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label
              htmlFor="shorts-title"
              className="text-muted-foreground text-xs"
            >
              Title
            </Label>
            <Input
              id="shorts-title"
              value={title}
              onChange={(e) =>
                dispatch({ type: "title-edited", title: e.target.value })
              }
              onBlur={() => dispatch({ type: "title-blurred", videoId })}
              placeholder="Short title..."
            />
            {metadataProblem?.field === "title" && (
              <p className="text-sm text-destructive">
                {metadataProblem.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="shorts-description">YouTube Description</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  dispatch({
                    type: "generate-clicked",
                    field: "description",
                    currentText: description,
                    askToReplace: false,
                    request: selectDescriptionRequest(videoId),
                  })
                }
                disabled={isGeneratingDescription}
              >
                {isGeneratingDescription ? (
                  <Loader2Icon className="h-3 w-3 animate-spin" />
                ) : (
                  <SparklesIcon className="h-3 w-3" />
                )}
              </Button>
            </div>
            <Textarea
              id="shorts-description"
              value={description}
              onChange={(e) =>
                dispatch({
                  type: "description-edited",
                  description: e.target.value,
                })
              }
              onBlur={() => dispatch({ type: "description-blurred", videoId })}
              disabled={isLoading}
              placeholder={isLoading ? "Loading..." : "YouTube description..."}
              className="min-h-[80px] resize-y"
            />
            {metadataProblem?.field === "description" && (
              <p className="text-sm text-destructive">
                {metadataProblem.message}
              </p>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: "convert-short-links-clicked" })}
            disabled={isConvertingShortLinks || !description.trim()}
          >
            {isConvertingShortLinks ? (
              <Loader2Icon className="h-3 w-3 animate-spin" />
            ) : (
              <LinkIcon className="h-3 w-3" />
            )}
            Convert to short links
          </Button>

          {verdict && (
            <p
              className={
                verdict.verdict === "refused"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {verdict.verdict === "refused"
                ? `Can't be queued: ${verdict.reason}`
                : `Goes out ${verdict.goesOutAt} (UK time)`}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => dispatch({ type: "add-to-queue-clicked", videoId })}
            disabled={!selectCanAdd(state)}
          >
            {state.adding ? (
              <Loader2Icon className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ListPlusIcon className="w-4 h-4 mr-2" />
            )}
            Add to Posting Queue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
