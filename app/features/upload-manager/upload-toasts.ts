import { toast } from "sonner";
import type { uploadReducer } from "./upload-reducer";

/**
 * Shows a toast notification when an upload transitions to "success".
 */
export function showSuccessToast(upload: uploadReducer.UploadEntry): void {
  if (upload.uploadType === "buffer") {
    const postUrl = `/videos/${upload.videoId}/post`;

    toast.success(`"${upload.title}" sent to Buffer`, {
      duration: Infinity,
      cancel: {
        label: "Go to Post",
        onClick: () => {
          window.location.href = postUrl;
        },
      },
    });
  } else if (upload.uploadType === "youtube") {
    const postUrl = `/videos/${upload.videoId}/post`;

    toast.success(`"${upload.title}" uploaded to YouTube`, {
      duration: Infinity,
      action: upload.youtubeVideoId
        ? {
            label: "Copy YouTube Studio Link",
            onClick: () =>
              navigator.clipboard.writeText(
                `https://studio.youtube.com/video/${upload.youtubeVideoId}/edit`
              ),
          }
        : undefined,
      cancel: {
        label: "Go to Post",
        onClick: () => {
          window.location.href = postUrl;
        },
      },
    });
  } else if (upload.uploadType === "ai-hero") {
    const aiHeroPageUrl = `/videos/${upload.videoId}/ai-hero`;

    toast.success(`"${upload.title}" posted to AI Hero`, {
      duration: Infinity,
      cancel: {
        label: "Go to AI Hero",
        onClick: () => {
          window.location.href = aiHeroPageUrl;
        },
      },
    });

    // Fire-and-forget: add AI Hero post URL to global links
    if (upload.aiHeroSlug) {
      const formData = new FormData();
      formData.append("title", upload.title);
      formData.append("url", `https://aihero.dev/${upload.aiHeroSlug}`);
      fetch("/api/links", {
        method: "POST",
        body: formData,
      }).catch(() => {
        // Silently ignore errors (including duplicate URL conflicts)
      });
    }
  } else if (upload.uploadType === "skills-changelog") {
    const pageUrl = `/videos/${upload.videoId}/skills-changelog`;

    toast.success(`"${upload.title}" published as Skills Changelog`, {
      duration: Infinity,
      cancel: {
        label: "Go to Skills Changelog",
        onClick: () => {
          window.location.href = pageUrl;
        },
      },
    });

    if (upload.skillsChangelogSlug) {
      const formData = new FormData();
      formData.append("title", upload.title);
      formData.append(
        "url",
        `https://www.aihero.dev/skills/${upload.skillsChangelogSlug}`
      );
      fetch("/api/links", {
        method: "POST",
        body: formData,
      }).catch(() => {});
    }
  } else if (upload.uploadType === "export") {
    toast.success(`"${upload.title}" exported successfully`, {
      duration: Infinity,
      cancel: {
        label: "Open",
        onClick: () => {
          fetch(`/api/videos/${upload.videoId}/reveal`, {
            method: "POST",
          }).catch(() => {});
        },
      },
    });
  } else if (upload.uploadType === "dropbox-publish") {
    const missingCount = upload.missingVideoCount ?? 0;
    if (missingCount > 0) {
      toast.warning(
        `"${upload.title}" published to Dropbox, but ${missingCount} video${missingCount === 1 ? " was" : "s were"} not exported`,
        { duration: Infinity }
      );
    } else {
      toast.success(`"${upload.title}" published to Dropbox`, {
        duration: Infinity,
      });
    }
  } else if (upload.uploadType === "publish") {
    const newDraftVersionId = upload.newDraftVersionId;
    const courseId = upload.courseId;
    toast.success(`"${upload.title}" published successfully`, {
      duration: Infinity,
      action: newDraftVersionId
        ? {
            label: "Go to Draft",
            onClick: () => {
              window.location.href = `/?courseId=${courseId}&versionId=${newDraftVersionId}`;
            },
          }
        : undefined,
    });
  }
}

/**
 * Shows a toast notification when an upload transitions to "error".
 */
export function showErrorToast(upload: uploadReducer.UploadEntry): void {
  const postUrl = `/videos/${upload.videoId}/post`;

  toast.error(`"${upload.title}" upload failed: ${upload.errorMessage}`, {
    duration: Infinity,
    cancel: {
      label: "Go to Post",
      onClick: () => {
        window.location.href = postUrl;
      },
    },
  });
}
