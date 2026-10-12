import { Button } from "@/components/ui/button";
import {
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  LoaderIcon,
  XIcon,
} from "lucide-react";
import { formatDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";
import { useRef, useState, useCallback, useEffect } from "react";
import type { IndexedClip } from "./types";
import {
  CHOOSE_SCREENSHOT_ATTR,
  SCREENSHOT_CAPTURE_EVENT,
  SCREENSHOT_STEP_EVENT,
  type ScreenshotCaptureRequest,
  type ScreenshotStep,
} from "./screenshot-navigation";
import { stepScreenshotFrame } from "./screenshot-frame-step";
import { useScreenshotSteps } from "./screenshot-io-step-dial";
import {
  clipCompositePicture,
  clipFrame,
  clipPlaybackClock,
  clipPlaybackUrl,
  clipSource,
  type ClipFrame,
} from "@/packages/clip-source";
import { CompositePlayback } from "@/features/video-editor/components/composite-playback";

const navAnchor = { [CHOOSE_SCREENSHOT_ATTR]: "" };

export interface ChooseScreenshotProps {
  clipIndex: number;
  alt: string;
  clips: IndexedClip[];
  onClipIndexChange: (currentIndex: number, newIndex: number) => void;
  onCapture: (
    clipIndex: number,
    alt: string,
    frame: ClipFrame
  ) => Promise<boolean>;
  onRemove: (clipIndex: number, alt: string) => void;
  isCapturing?: boolean;
  isStreaming?: boolean;
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
}: ChooseScreenshotProps) {
  const clip = clips.find((c) => c.index === clipIndex);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Where the next clip shown opens: its end after I crossed back into it. */
  const landAtRef = useRef<"start" | "end">("start");
  const { steps, dials } = useScreenshotSteps();

  // Every time kept here is the Clip's source time. The `<video>` is the
  // playback clock: an OBS Clip's Footage, or a new-recorder Clip's mic,
  // `offset` behind the picture (drawn by CompositePlayback).
  const source = clip ? clipSource(clip) : null;
  const offset = source ? clipPlaybackClock(source).offsetSeconds : 0;
  const seekVideo = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time - offset;
  };

  const isFirstClip = clipIndex <= 1;
  const isLastClip = clipIndex >= clips.length;

  const landingTime = (c: IndexedClip) =>
    landAtRef.current === "end" ? c.sourceEndTime : c.sourceStartTime;

  useEffect(() => {
    if (clip && videoRef.current) {
      const time = landingTime(clip);
      seekVideo(time);
      setCurrentTime(time);
    }
  }, [clip?.sourceStartTime]);

  const changeClip = (newIndex: number, landAt: "start" | "end") => {
    landAtRef.current = landAt;
    onClipIndexChange(clipIndex, newIndex);
  };

  const handleStep = ({ direction, size }: ScreenshotStep) => {
    if (!clip) return;
    const next = stepScreenshotFrame({
      time: currentTime,
      clipStart: clip.sourceStartTime,
      clipEnd: clip.sourceEndTime,
      clipIndex,
      clipCount: clips.length,
      step: steps[size],
      direction,
    });
    if (next?.type === "seek") {
      seekVideo(next.time);
      setCurrentTime(next.time);
    } else if (next?.type === "change-clip") {
      changeClip(next.newIndex, next.landAt);
    }
  };
  const capture = () =>
    clip
      ? onCapture(clipIndex, alt, clipFrame(clipSource(clip), currentTime))
      : Promise.resolve(false);

  const handleCaptureRequest = async (request: ScreenshotCaptureRequest) => {
    if (isCapturing) return;
    if (await capture()) request.onCaptured();
  };

  const handlersRef = useRef({ handleStep, handleCaptureRequest });
  handlersRef.current = { handleStep, handleCaptureRequest };

  // Bridge: the keys arrive from useScreenshotNavigation as DOM events.
  const isLive = Boolean(clip) && !isStreaming;
  useEffect(() => {
    const el = rootRef.current;
    if (!isLive || !el) return;
    const onStep = (e: Event) =>
      handlersRef.current.handleStep((e as CustomEvent<ScreenshotStep>).detail);
    const onCaptureRequest = (e: Event) =>
      void handlersRef.current.handleCaptureRequest(
        (e as CustomEvent<ScreenshotCaptureRequest>).detail
      );
    el.addEventListener(SCREENSHOT_STEP_EVENT, onStep);
    el.addEventListener(SCREENSHOT_CAPTURE_EVENT, onCaptureRequest);
    return () => {
      el.removeEventListener(SCREENSHOT_STEP_EVENT, onStep);
      el.removeEventListener(SCREENSHOT_CAPTURE_EVENT, onCaptureRequest);
    };
  }, [isLive]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || !clip) return;
    const time = videoRef.current.currentTime + offset;
    // Clamp to clip boundaries
    const clamped = Math.min(
      Math.max(time, clip.sourceStartTime),
      clip.sourceEndTime
    );
    if (clamped !== time) seekVideo(clamped);
    setCurrentTime(clamped);
  }, [clip, offset]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!videoRef.current || !clip) return;
      const time = parseFloat(e.target.value);
      seekVideo(time);
      setCurrentTime(time);
    },
    [clip, offset]
  );

  if (!clip) {
    return (
      <div
        {...navAnchor}
        className="transition-shadow my-4 rounded-lg border border-destructive bg-destructive/10 p-4"
      >
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
  const picture = clipCompositePicture(source!, {
    from: clip.sourceStartTime,
    to: clip.sourceEndTime,
  });

  if (isStreaming) {
    return (
      <div
        {...navAnchor}
        className="transition-shadow my-4 rounded-lg border border-border bg-muted/50 p-4"
      >
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

  return (
    <div
      {...navAnchor}
      ref={rootRef}
      className="transition-shadow my-4 rounded-lg border border-border bg-muted/50 p-4 relative"
    >
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
      <video
        ref={videoRef}
        src={clipPlaybackUrl(source!, {
          from: clip.sourceStartTime,
          to: clip.sourceEndTime,
        })}
        className={cn("w-full rounded-md aspect-video", picture && "hidden")}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          // Re-apply the frame already chosen: a key pressed while the
          // video was loading must not be thrown away.
          seekVideo(
            Math.min(
              Math.max(currentTime, clip.sourceStartTime),
              clip.sourceEndTime
            )
          );
        }}
      />
      {picture && (
        <CompositePlayback
          clock={videoRef}
          picture={picture}
          offsetSeconds={offset}
          hidden={false}
          className="rounded-md"
        />
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
          {formatDuration(currentTime - clip.sourceStartTime)}
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
          {formatDuration(duration)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isFirstClip}
          onClick={() => changeClip(clipIndex - 1, "start")}
        >
          <ChevronLeftIcon className="h-3 w-3 mr-1" />
          Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isLastClip}
          onClick={() => changeClip(clipIndex + 1, "start")}
        >
          Next
          <ChevronRightIcon className="h-3 w-3 ml-1" />
        </Button>
        <div className="flex-1" />
        {dials}
        <Button size="sm" disabled={isCapturing} onClick={() => void capture()}>
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
