import { toast } from "@/components/ui/toast";
import { jobLogHref } from "./job-wire";
import type { jobsReducer } from "./jobs-reducer";

type Toast<T extends jobsReducer.Effect["type"]> = Extract<
  jobsReducer.Effect,
  { type: T }
>;

const FAILED: Record<string, string> = {
  export: "export failed",
  "export-animatic": "Animatic export failed",
  "render-vertical": "vertical Short render failed",
  youtube: "upload failed",
  "youtube-shorts": "YouTube Short post failed",
  buffer: "Buffer post failed",
  "ai-hero": "AI Hero post failed",
  "skills-changelog": "Skills Changelog post failed",
  autofill: "failed",
  /** One Video of a Course Autofill: nothing of it was written. */
  "autofill-video": "autofill failed",
  publish: "publish failed",
  "duplicate-course": "duplicate failed",
  "storage-move": "failed: every original is untouched",
  "storage-delete": "stopped: every file not deleted is still there",
  /** One Video of a Publish: its export or its upload. */
  "publish-video": "failed in the Publish",
};

const goTo = (label: string, href: string) => ({
  label,
  onClick: () => {
    window.location.href = href;
  },
});

/** Saves a posted page to the global links; fire-and-forget. */
const addGlobalLink = (title: string, url: string) => {
  const formData = new FormData();
  formData.append("title", title);
  formData.append("url", url);
  fetch("/api/links", { method: "POST", body: formData }).catch(() => {
    // Silently ignore errors (including duplicate URL conflicts)
  });
};

/**
 * A Job succeeded: the toast the reducer decided (`effect.toast`). A post
 * toasts exactly as the browser-driven upload did: same words, same links,
 * and AI Hero's link saved to the global links.
 */
export function showJobSucceededToast(
  effect: Toast<"show-job-succeeded-toast">
): void {
  const { title, toast: decided } = effect;
  switch (decided.shape) {
    case "buffer":
      toast.success(`"${title}" sent to Buffer`, {
        duration: Infinity,
        cancel: goTo("Go to Post", `/videos/${decided.videoId}/post`),
      });
      return;
    case "youtube": {
      const { youtubeVideoId } = decided;
      toast.success(`"${title}" uploaded to YouTube`, {
        duration: Infinity,
        action: youtubeVideoId
          ? {
              label: "Copy YouTube Studio Link",
              onClick: () => {
                // Nothing waits on a toast button, so the copy reports its
                // own failure rather than reject unheard.
                navigator.clipboard
                  .writeText(
                    `https://studio.youtube.com/video/${youtubeVideoId}/edit`
                  )
                  .catch(() => {
                    toast.error("Failed to copy YouTube Studio link");
                  });
              },
            }
          : undefined,
        cancel: goTo("Go to Post", `/videos/${decided.videoId}/post`),
      });
      return;
    }
    case "youtube-shorts": {
      const { youtubeVideoId } = decided;
      toast.success(`"${title}" posted as YouTube Short`, {
        duration: Infinity,
        action: youtubeVideoId
          ? {
              label: "Open on YouTube",
              onClick: () =>
                window.open(
                  `https://youtube.com/shorts/${youtubeVideoId}`,
                  "_blank"
                ),
            }
          : undefined,
      });
      return;
    }
    case "ai-hero":
      toast.success(`"${title}" posted to AI Hero`, {
        duration: Infinity,
        cancel: goTo("Go to AI Hero", `/videos/${decided.videoId}/ai-hero`),
      });
      if (decided.slug) {
        addGlobalLink(title, `https://aihero.dev/${decided.slug}`);
      }
      return;
    case "skills-changelog":
      toast.success(`"${title}" published as Skills Changelog`, {
        duration: Infinity,
        cancel: goTo(
          "Go to Skills Changelog",
          `/videos/${decided.videoId}/skills-changelog`
        ),
      });
      if (decided.slug) {
        addGlobalLink(title, `https://www.aihero.dev/skills/${decided.slug}`);
      }
      return;
    case "autofill":
      // The Autofill never rolls on into a Publish — the second press is the
      // author's. So the toast carries them back to where that press happens.
      toast.success(`${title} finished`, {
        duration: Infinity,
        action: goTo("Back to Publish", `/courses/${decided.courseId}/publish`),
      });
      return;
    case "publish": {
      const { courseId, newDraftVersionId } = decided;
      toast.success(`"${title}" published successfully`, {
        duration: Infinity,
        action: newDraftVersionId
          ? goTo(
              "Go to Draft",
              `/courses/${courseId}?versionId=${newDraftVersionId}`
            )
          : undefined,
      });
      return;
    }
    case "generic": {
      const { revealVideoId } = decided;
      toast.success(`"${title}" ${decided.did}`, {
        duration: Infinity,
        cancel: revealVideoId
          ? {
              label: "Open",
              onClick: () => {
                fetch(`/api/videos/${revealVideoId}/reveal`, {
                  method: "POST",
                }).catch(() => {
                  // Revealing the file is a convenience; the toast said where it is.
                });
              },
            }
          : undefined,
      });
      return;
    }
  }
}

export function showJobFailedToast(
  effect: Toast<"show-job-failed-toast">
): void {
  const failed = FAILED[effect.kind] ?? "failed";
  toast.error(`"${effect.title}" ${failed}: ${effect.message}`, {
    duration: Infinity,
    // `action` is the error toast's "Copy"; the log goes beside it.
    cancel: effect.hasLog
      ? {
          label: "View log",
          onClick: () => {
            window.open(jobLogHref(effect.jobId), "_blank", "noopener");
          },
        }
      : undefined,
  });
}

export function showSidecarNotRunningToast(
  effect: Toast<"show-sidecar-not-running-toast">
): void {
  toast.warning(`"${effect.title}" is queued, but the sidecar is not running`, {
    description:
      "It starts as soon as the sidecar does: `pnpm dev` and `pnpm start` run it.",
  });
}

export function showRetryFailedToast(
  effect: Toast<"show-retry-failed-toast">
): void {
  toast.error(`Could not retry "${effect.title}": ${effect.message}`, {
    duration: Infinity,
  });
}

export function showCancelFailedToast(
  effect: Toast<"show-cancel-failed-toast">
): void {
  toast.error(`Could not cancel "${effect.title}": ${effect.message}`);
}

export function showDismissFailedToast(
  effect: Toast<"show-dismiss-failed-toast">
): void {
  const what = effect.count === 1 ? "that row" : `${effect.count} rows`;
  toast.error(
    `Could not dismiss ${what} for good, so it will be back in the next tab: ${effect.message}`
  );
}
