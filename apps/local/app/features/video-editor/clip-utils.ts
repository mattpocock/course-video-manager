import levenshtein from "js-levenshtein";
import type { Clip, Chapter, TimelineItem } from "./clip-state-reducer";

/**
 * Calculate text similarity between two strings using Levenshtein distance.
 * Returns a percentage from 0 to 100, where 100 is identical strings.
 */
export function calculateTextSimilarity(str1: string, str2: string): number {
  const distance = levenshtein(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  // Handle edge case of empty strings
  if (maxLength === 0) return 100;

  const similarity = (1 - distance / maxLength) * 100;
  return Math.max(0, Math.round(similarity * 100) / 100); // Round to 2 decimal places
}

/**
 * Type guard to check if a timeline item is a clip.
 */
export const isClip = (item: TimelineItem): item is Clip =>
  item.type === "on-database" || item.type === "optimistically-added";

/**
 * Type guard to check if a timeline item is a chapter.
 */
export const isChapter = (item: TimelineItem): item is Chapter =>
  item.type === "chapter-on-database" ||
  item.type === "chapter-optimistically-added";
