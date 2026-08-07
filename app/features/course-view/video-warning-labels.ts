import type { VideoWarning } from "@/services/video-warnings";

export const VIDEO_WARNING_LABELS: Record<VideoWarning["kind"], string> = {
  missingChapters: "Missing chapters",
  missingBody: "Missing lesson body",
  missingDescription: "Missing SEO description",
  duplicateQuizId: "Duplicate quiz id",
};

export function videoWarningLabel(warnings: VideoWarning[]): string {
  return warnings.map((w) => VIDEO_WARNING_LABELS[w.kind]).join(" · ");
}
