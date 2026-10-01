import { useState, useMemo } from "react";
import {
  buildVideoChapters,
  toYouTubeChapters,
  type ChapterTimelineItem,
} from "@/services/video-chapters";
import { isClip, isChapter } from "../clip-utils";
import type { TimelineItem } from "../clip-state-reducer";

/**
 * Custom hook for clipboard operations in the video editor.
 *
 * Provides:
 * - copyTranscriptToClipboard: Copies transcript with section headers to clipboard
 * - copyYoutubeChaptersToClipboard: Copies YouTube chapters with timestamps
 * - isCopied/isChaptersCopied: State for showing copy feedback
 * - youtubeChapters: Computed chapters from chapters
 */
export const useClipboardOperations = (items: TimelineItem[]) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isChaptersCopied, setIsChaptersCopied] = useState(false);

  const copyTranscriptToClipboard = async () => {
    try {
      // Build transcript with chapters as markdown headers
      const parts: string[] = [];
      let currentParagraph: string[] = [];

      for (const item of items) {
        if (isChapter(item)) {
          // Flush current paragraph before starting a new section
          if (currentParagraph.length > 0) {
            parts.push(currentParagraph.join(" "));
            currentParagraph = [];
          }
          // Add section as H2 header
          parts.push(`## ${item.name}`);
        } else if (isClip(item) && item.type === "on-database" && item.text) {
          currentParagraph.push(item.text);
        }
      }

      // Flush remaining paragraph
      if (currentParagraph.length > 0) {
        parts.push(currentParagraph.join(" "));
      }

      // Join sections with double newlines
      const transcript = parts.join("\n\n");

      await navigator.clipboard.writeText(transcript);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy transcript to clipboard:", error);
    }
  };

  // The same chapter list the published course.json carries, in the
  // YouTube "0:00 Chapter Name" form.
  const youtubeChapters = useMemo(() => {
    const timeline = items
      .map((item): ChapterTimelineItem | null => {
        if (isChapter(item)) {
          return { kind: "chapter", name: item.name };
        } else if (isClip(item) && item.type === "on-database") {
          return {
            kind: "clip",
            durationSeconds: item.sourceEndTime - item.sourceStartTime,
          };
        }
        return null;
      })
      .filter((item): item is ChapterTimelineItem => item !== null);

    return toYouTubeChapters(buildVideoChapters(timeline));
  }, [items]);

  const copyYoutubeChaptersToClipboard = async () => {
    try {
      const chaptersText = youtubeChapters
        .map((chapter) => `${chapter.timestamp} ${chapter.name}`)
        .join("\n");

      await navigator.clipboard.writeText(chaptersText);
      setIsChaptersCopied(true);
      setTimeout(() => setIsChaptersCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy YouTube chapters to clipboard:", error);
    }
  };

  return {
    copyTranscriptToClipboard,
    copyYoutubeChaptersToClipboard,
    isCopied,
    isChaptersCopied,
    youtubeChapters,
  };
};
