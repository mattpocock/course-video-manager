import { consumeSSEStream } from "./consume-sse-stream";

export interface SSESkillsChangelogParams {
  videoId: string;
  title: string;
  slug: string;
  body: string;
  description: string;
  newsletterSubject: string;
  newsletterPreviewText: string;
  newsletterCopy: string;
}

export interface SSESkillsChangelogCallbacks {
  onProgress: (percentage: number) => void;
  onComplete: (slug: string) => void;
  onError: (message: string) => void;
}

export const startSSESkillsChangelogPost = (
  params: SSESkillsChangelogParams,
  callbacks: SSESkillsChangelogCallbacks
): AbortController =>
  consumeSSEStream({
    url: `/api/videos/${params.videoId}/post-skills-changelog`,
    body: {
      title: params.title,
      slug: params.slug,
      body: params.body,
      description: params.description,
      newsletterSubject: params.newsletterSubject,
      newsletterPreviewText: params.newsletterPreviewText,
      newsletterCopy: params.newsletterCopy,
    },
    events: {
      progress: (data: { percentage: number }) =>
        callbacks.onProgress(data.percentage),
      complete: (data: { slug: string }) => callbacks.onComplete(data.slug),
      error: (data: { message: string }) => callbacks.onError(data.message),
    },
    onError: callbacks.onError,
    errorLabel: "Skills Changelog post failed",
  });
