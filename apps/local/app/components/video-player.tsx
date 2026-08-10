import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRef } from "react";
import { useAudioBoost } from "@/features/video-editor/use-audio-boost";
import { PREVIEW_AUDIO_BOOST_DB } from "@/features/video-editor/constants";

interface VideoPlayerProps {
  videoId: string;
  videoTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export function VideoModal({
  videoId,
  videoTitle,
  isOpen,
  onClose,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useAudioBoost(videoRef, PREVIEW_AUDIO_BOOST_DB);

  const handleClose = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
    onClose();
  };

  if (videoRef.current) {
    videoRef.current.playbackRate = 1.75;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{videoTitle}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <video
            ref={videoRef}
            className="w-full h-auto max-h-[70vh] rounded-md"
            controls
            autoPlay
          >
            <source src={`/api/videos/${videoId}/stream`} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
      </DialogContent>
    </Dialog>
  );
}
