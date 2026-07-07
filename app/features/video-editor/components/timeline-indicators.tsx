import { PlusIcon } from "lucide-react";
import { INSERTION_POINT_ID } from "../constants";

/**
 * Visual indicator showing where new clips will be inserted in the timeline.
 * Displays a dashed blue line with a plus icon in the center.
 */
export const InsertionPointIndicator = () => {
  return (
    <div
      id={INSERTION_POINT_ID}
      className="flex items-center justify-center gap-4"
    >
      <div className="border-t-2 w-full border-blue-400 dark:border-blue-200 border-dashed flex-1" />
      <div className="flex items-center justify-center">
        <PlusIcon className="size-5 text-blue-400 dark:text-blue-200" />
        {/* <span className="text-blue-400 dark:text-blue-200 text-sm">New Clips</span> */}
      </div>
      <div className="border-t-2 w-full border-blue-400 dark:border-blue-200 border-dashed flex-1" />
    </div>
  );
};

/**
 * Visual indicator showing a held pause between clips.
 * Displays three gray dots in a row.
 */
export const PauseIndicator = () => {
  return (
    <div className="flex items-center justify-center gap-1 pt-5 pb-1">
      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
    </div>
  );
};

/**
 * Visual indicator showing that recording is in progress.
 * Displays a pulsing red circle in the top-right corner of the video.
 */
export const RecordingSignalIndicator = () => {
  return (
    <div className="absolute top-6 right-6 flex items-center justify-center">
      <div className="w-10 h-10 bg-red-700 rounded-full animate-pulse" />
    </div>
  );
};
