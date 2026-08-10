import { Circle, Download, Send, type LucideIcon } from "lucide-react";

export type ShortStatus = "recorded" | "exported" | "posted";

export type PostedPlatforms = { youtube: boolean; tiktok: boolean };

export function getShortStatus(
  videoId: string,
  exportedMap: Record<string, boolean>,
  postedMap: Record<string, PostedPlatforms>
): ShortStatus {
  const posted = postedMap[videoId];
  if (posted && (posted.youtube || posted.tiktok)) return "posted";
  if (exportedMap[videoId]) return "exported";
  return "recorded";
}

export const STATUS_META: Record<
  ShortStatus,
  { label: string; icon: LucideIcon }
> = {
  recorded: { label: "Recorded", icon: Circle },
  exported: { label: "Exported", icon: Download },
  posted: { label: "Posted", icon: Send },
};
