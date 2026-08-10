export const formatSecondsToTimeCode = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

/**
 * Represents a timeline item for YouTube chapters calculation.
 * Can be either a clip (with duration) or a section (chapter marker).
 */
export type YouTubeChaptersItem =
  { type: "clip"; durationSeconds: number } | { type: "section"; name: string };

/**
 * Calculate YouTube chapter timestamps from a sorted list of timeline items.
 *
 * This utility takes clips (with duration) and sections (chapter markers) in
 * timeline order and produces chapter timestamps in "M:SS Section Name" format.
 *
 * @param items - Sorted array of clips and sections in timeline order
 * @returns Array of chapters with timestamp and name
 */
export const calculateYouTubeChapters = (
  items: YouTubeChaptersItem[]
): { timestamp: string; name: string }[] => {
  const chapters: { timestamp: string; name: string }[] = [];
  let cumulativeDuration = 0;

  for (const item of items) {
    if (item.type === "section") {
      chapters.push({
        timestamp: formatSecondsToTimeCode(cumulativeDuration),
        name: item.name,
      });
    } else {
      cumulativeDuration += item.durationSeconds;
    }
  }

  return chapters;
};
