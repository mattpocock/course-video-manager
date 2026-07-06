import type { VideoWarning } from "@/services/video-warnings";

export const VIDEO_WARNING_LABELS: Record<VideoWarning["kind"], string> = {
  missingOpeningChapter: "Missing opening section",
  missingBody: "Missing lesson body",
  missingDescription: "Missing SEO description",
};

export function videoWarningLabel(warnings: VideoWarning[]): string {
  return warnings.map((w) => VIDEO_WARNING_LABELS[w.kind]).join(" · ");
}
