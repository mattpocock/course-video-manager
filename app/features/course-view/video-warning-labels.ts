import type { VideoWarning } from "@/services/video-warnings";

export const VIDEO_WARNING_LABELS: Record<VideoWarning["kind"], string> = {
  missingOpeningChapter: "Missing opening section",
  missingBody: "Missing lesson body",
  missingDescription: "Missing SEO description",
};

export function videoWarningLabel(warnings: VideoWarning[]): string {
  return warnings.map((w) => VIDEO_WARNING_LABELS[w.kind]).join(" · ");
}

/**
 * Action-menu items that exist to supply a piece of missing content, mapped to
 * the warning that content's absence raises. Lets the menu flag the gap right
 * where you'd go and fill it.
 */
const VIDEO_ACTION_WARNING_KINDS = {
  "edit-lesson-body": "missingBody",
  "generate-seo-description": "missingDescription",
  "generate-chapters": "missingOpeningChapter",
} as const satisfies Record<string, VideoWarning["kind"]>;

export type VideoWarningAction = keyof typeof VIDEO_ACTION_WARNING_KINDS;

/**
 * The warning to show beside an action-menu item, or `null` when that item's
 * content is already there.
 */
export function videoActionWarningLabel(
  warnings: VideoWarning[],
  action: VideoWarningAction
): string | null {
  const kind = VIDEO_ACTION_WARNING_KINDS[action];
  return warnings.some((w) => w.kind === kind)
    ? VIDEO_WARNING_LABELS[kind]
    : null;
}
