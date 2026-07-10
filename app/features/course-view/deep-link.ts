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
