import { toast } from "sonner";

type DeepLinkTarget =
  | {
      courseId: string;
      sectionId: string;
      lessonId?: undefined;
      videoId?: undefined;
      beatId?: undefined;
    }
  | {
      courseId: string;
      sectionId: string;
      lessonId: string;
      videoId?: undefined;
      beatId?: undefined;
    }
  | {
      courseId: string;
      sectionId: string;
      videoId: string;
      lessonId?: undefined;
      beatId?: undefined;
    }
  | {
      courseId: string;
      sectionId: string;
      videoId: string;
      beatId: string;
      lessonId?: undefined;
    };

export type VideoDeepLinkTarget = {
  courseId: string;
  sectionId: string;
  videoId: string;
};

/**
 * The deep-link target that addresses one Video, or null when the Video is
 * standalone — a Video with no Lesson sits under no Section and no Course, so
 * there is no address to copy. Lets a surface that only knows the video's own
 * route data (the editor's Actions menu) decide whether to offer the action.
 */
export function videoDeepLinkTarget(input: {
  courseId: string | undefined;
  sectionId: string | undefined;
  videoId: string;
}): VideoDeepLinkTarget | null {
  if (!input.courseId || !input.sectionId) return null;
  return {
    courseId: input.courseId,
    sectionId: input.sectionId,
    videoId: input.videoId,
  };
}

export function buildDeepLink(target: DeepLinkTarget): string {
  let link = `course:${target.courseId}/section:${target.sectionId}`;
  if (target.lessonId) {
    link += `/lesson:${target.lessonId}`;
  }
  if (target.videoId) {
    link += `/video:${target.videoId}`;
  }
  if (target.beatId) {
    link += `/beat:${target.beatId}`;
  }
  return link;
}

export async function copyDeepLink(target: DeepLinkTarget) {
  const link = buildDeepLink(target);
  try {
    await navigator.clipboard.writeText(link);
    toast("Deep link copied to clipboard");
  } catch {
    toast.error("Failed to copy deep link to clipboard");
  }
}
