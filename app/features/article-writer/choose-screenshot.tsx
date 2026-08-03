import { Button } from "@/components/ui/button";
import {
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  LoaderIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState, useCallback, useEffect } from "react";
import type { IndexedClip, ScreenshotProposal } from "./types";

export interface ChooseScreenshotProps {
  clipIndex: number;
  alt: string;
  clips: IndexedClip[];
  onClipIndexChange: (currentIndex: number, newIndex: number) => void;
  onCapture: (
    clipIndex: number,
    alt: string,
    timestamp: number,
    videoFilename: string
  ) => void;
  onRemove: (clipIndex: number, alt: string) => void;
  isCapturing?: boolean;
  isStreaming?: boolean;
  /** Ask the judge to find a frame for this block. */
  onFindScreenshot?: (clipIndex: number, alt: string) => void;
  /** Accept a proposal as-is, reusing the frame already captured for preview. */
  onApplyProposal?: (clipIndex: number, alt: string, imagePath: string) => void;
  onDismissProposal?: (clipIndex: number, alt: string) => void;
  proposal?: ScreenshotProposal;
  isProposing?: boolean;
}

export function ChooseScreenshot({
  clipIndex,
  alt,
  clips,
  onClipIndexChange,
  onCapture,
  onRemove,
  isCapturing,
  isStreaming,
  onFindScreenshot,
  onApplyProposal,
  onDismissProposal,
  proposal,
  isProposing,
}: ChooseScreenshotProps) {
  const clip = clips.find((c) => c.index === clipIndex);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const isFirstClip = clipIndex <= 1;
  const isLastClip = clipIndex >= clips.length;

  useEffect(() => {
    if (clip && videoRef.current) {
      videoRef.current.currentTime = clip.sourceStartTime;
      setCurrentTime(clip.sourceStartTime);
    }
  }, [clip?.sourceStartTime]);

  const proposedTime = proposal?.found ? proposal.timestamp : undefined;

  // Seek to a proposal so "the judge was 0.4s off" is a nudge of the scrubber
  // rather than a rejection. Declared after the reset effect above so that when
  // a proposal retargets the block to a neighbouring clip — which resets the
  // scrubber to that clip's start — this still wins on the same render.
  useEffect(() => {
    if (proposedTime === undefined || !videoRef.current || !clip) return;
    if (
      proposedTime < clip.sourceStartTime ||
      proposedTime > clip.sourceEndTime
    )
      return;
    videoRef.current.currentTime = proposedTime;
    setCurrentTime(proposedTime);
  }, [proposedTime, clip?.sourceStartTime, clip?.sourceEndTime]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || !clip) return;
    const time = videoRef.current.currentTime;
    // Clamp to clip boundaries
    if (time < clip.sourceStartTime) {
      videoRef.current.currentTime = clip.sourceStartTime;
    } else if (time > clip.sourceEndTime) {
      videoRef.current.currentTime = clip.sourceEndTime;
    }
    setCurrentTime(videoRef.current.currentTime);
  }, [clip]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!videoRef.current || !clip) return;
      const time = parseFloat(e.target.value);
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    },
    [clip]
  );

  if (!clip) {
    return (
      <div className="my-4 rounded-lg border border-destructive bg-destructive/10 p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangleIcon className="h-4 w-4" />
          <span className="text-sm font-medium">
            Invalid clip index: {clipIndex}
          </span>
        </div>
      </div>
    );
  }

  const duration = clip.sourceEndTime - clip.sourceStartTime;

  if (isStreaming) {
    return (
      <div className="my-4 rounded-lg border border-border bg-muted/50 p-4">
        <p className="mb-2 text-xs text-muted-foreground">
          Clip {clipIndex} — {alt}
        </p>
        {clip.text && (
          <p className="mb-3 text-sm text-muted-foreground italic line-clamp-3">
            {clip.text}
          </p>
        )}
        <div className="w-full aspect-video rounded-md bg-muted flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <LoaderIcon className="h-4 w-4 animate-spin" />
            <span className="text-sm">Waiting for response to complete…</span>
          </div>
        </div>
      </div>
    );
  }

  // The scrubber having moved off the proposed frame means the preview png is
  // stale, so Apply has to re-capture at the new position instead of reusing it.
  const isOnProposedFrame =
    proposedTime !== undefined && Math.abs(currentTime - proposedTime) < 0.01;

  return (
    <div className="my-4 rounded-lg border border-border bg-muted/50 p-4 relative">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-foreground"
        onClick={() => onRemove(clipIndex, alt)}
      >
        <XIcon className="h-3.5 w-3.5" />
      </Button>
      <p className="mb-2 text-xs text-muted-foreground">
        Clip {clipIndex} — {alt}
      </p>
      {clip.text && (
        <p className="mb-3 text-sm text-muted-foreground italic line-clamp-3">
          {clip.text}
        </p>
      )}

      {proposal?.found === false && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span className="text-amber-900 dark:text-amber-200">
            No good frame found. {proposal.reason}
          </span>
        </div>
      )}

      {proposal?.found === true && (
        <div className="mb-3 rounded-md border border-primary/40 bg-primary/5 p-2">
          <img
            src={`/view-image?imagePath=${encodeURIComponent(proposal.absoluteImagePath)}`}
            alt={alt}
            className="w-full rounded-md"
          />
          <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
            <SparklesIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              {proposal.reason}{" "}
              <span className="tabular-nums opacity-70">
                ({formatTime(proposal.timestamp - clip.sourceStartTime)} into
                clip {proposal.clipIndex})
              </span>
            </span>
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              disabled={isCapturing}
              onClick={() => {
                if (isOnProposedFrame) {
                  onApplyProposal?.(clipIndex, alt, proposal.imagePath);
                } else {
                  onCapture(clipIndex, alt, currentTime, clip.videoFilename);
                }
              }}
            >
              {isCapturing ? (
                <LoaderIcon className="h-3 w-3 mr-1 animate-spin" />
              ) : null}
              {isOnProposedFrame ? "Apply" : "Apply at scrubber"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDismissProposal?.(clipIndex, alt)}
            >
              Reject
            </Button>
          </div>
        </div>
      )}

      <video
        ref={videoRef}
        src={`/view-video?videoPath=${encodeURIComponent(clip.videoFilename)}#t=${clip.sourceStartTime},${clip.sourceEndTime}`}
        className="w-full rounded-md aspect-video"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            videoRef.current.currentTime =
              proposedTime !== undefined &&
              proposedTime >= clip.sourceStartTime &&
              proposedTime <= clip.sourceEndTime
                ? proposedTime
                : clip.sourceStartTime;
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
          {formatTime(currentTime - clip.sourceStartTime)}
        </span>
        <input
          type="range"
          min={clip.sourceStartTime}
          max={clip.sourceEndTime}
          step={0.1}
          value={currentTime}
          onChange={handleScrub}
          className="flex-1 h-1.5 accent-primary"
        />
        <span className="text-xs text-muted-foreground tabular-nums w-12">
          {formatTime(duration)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isFirstClip}
          onClick={() => onClipIndexChange(clipIndex, clipIndex - 1)}
        >
          <ChevronLeftIcon className="h-3 w-3 mr-1" />
          Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isLastClip}
          onClick={() => onClipIndexChange(clipIndex, clipIndex + 1)}
        >
          Next
          <ChevronRightIcon className="h-3 w-3 ml-1" />
        </Button>
        <div className="flex-1" />
        {onFindScreenshot && (
          <Button
            variant="outline"
            size="sm"
            disabled={isProposing}
            onClick={() => onFindScreenshot(clipIndex, alt)}
          >
            {isProposing ? (
              <LoaderIcon className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <SparklesIcon className="h-3 w-3 mr-1" />
            )}
            {isProposing ? "Looking…" : "Find it"}
          </Button>
        )}
        <Button
          size="sm"
          disabled={isCapturing}
          onClick={() =>
            onCapture(clipIndex, alt, currentTime, clip.videoFilename)
          }
        >
          {isCapturing ? (
            <LoaderIcon className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <CameraIcon className="h-3 w-3 mr-1" />
          )}
          {isCapturing ? "Capturing…" : "Capture"}
        </Button>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
