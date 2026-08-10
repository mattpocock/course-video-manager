import { useEffect, useRef } from "react";
import { CheckIcon, Loader2, MicIcon, MicOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveMediaStreamProps } from "../types";

/**
 * LiveMediaStream displays a live video feed from a media stream with visual indicators
 * for recording state and speech detection status.
 *
 * Features:
 * - Shows status indicators (recording, speaking, silence, etc.)
 * - Dynamic outline colors based on speech detection state
 * - Optional center line guide for camera framing
 * - Auto-plays the video stream when mounted or stream changes
 *
 * `showCaptureStatus` false turns the first two off wholesale — badge and ring,
 * recording and idle alike — so the teleprompter is the only screen reporting
 * the take.
 */
export const LiveMediaStream = (props: LiveMediaStreamProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = props.mediaStream;
      videoRef.current.play();
    }
  }, [props.mediaStream, videoRef.current]);

  const isRecording = props.obsConnectorState.type === "obs-recording";
  const showRecordingStatus = props.showCaptureStatus && isRecording;
  const showIdleStatus = props.showCaptureStatus && !isRecording;

  return (
    <div className={cn("relative w-full h-full")}>
      {showRecordingStatus && props.speechDetectorState.type === "silence" && (
        <div className="absolute top-4 left-4 bg-blue-600 rounded-full size-8 flex items-center justify-center">
          <CheckIcon className="size-4 text-white" />
        </div>
      )}
      {showRecordingStatus &&
        props.speechDetectorState.type === "speaking-detected" && (
          <div className="absolute top-4 left-4 bg-yellow-600 rounded-full size-8 flex items-center justify-center">
            <MicIcon className="size-4 text-white" />
          </div>
        )}
      {showRecordingStatus &&
        props.speechDetectorState.type ===
          "long-enough-speaking-for-clip-detected" && (
          <div className="absolute top-4 left-4 bg-green-600 rounded-full size-8 flex items-center justify-center">
            <MicIcon className="size-4 text-white" />
          </div>
        )}
      {showRecordingStatus &&
        props.speechDetectorState.type === "warming-up" && (
          <div className="absolute top-4 left-4 bg-red-600 rounded-full size-8 flex items-center justify-center">
            <Loader2 className="size-4 text-white animate-spin" />
          </div>
        )}
      {showIdleStatus && (
        <div className="absolute top-4 left-4 bg-muted rounded-full size-8 flex items-center justify-center">
          <MicOffIcon className="size-4 text-foreground" />
        </div>
      )}
      {props.showCenterLine && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="border-l-2 border-dashed border-muted-foreground/50 h-full"></div>
        </div>
      )}

      <video
        ref={videoRef}
        muted
        className={cn(
          "w-full h-full object-contain",
          "ring-4",
          "ring-muted-foreground",
          "rounded-lg",
          showRecordingStatus &&
            props.speechDetectorState.type === "speaking-detected" &&
            "ring-yellow-600",
          showRecordingStatus &&
            props.speechDetectorState.type ===
              "long-enough-speaking-for-clip-detected" &&
            "ring-green-600",
          showRecordingStatus &&
            props.speechDetectorState.type === "silence" &&
            "ring-blue-600",
          showRecordingStatus &&
            props.speechDetectorState.type === "warming-up" &&
            "ring-red-600"
        )}
      />
    </div>
  );
};
