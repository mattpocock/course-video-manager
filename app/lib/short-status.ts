import { Circle, Download, Send, type LucideIcon } from "lucide-react";

export type ShortStatus = "recorded" | "exported" | "posted";

export function getShortStatus(
  videoId: string,
  exportedMap: Record<string, boolean>,
  postedMap: Record<string, boolean>
): ShortStatus {
  if (postedMap[videoId]) return "posted";
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
