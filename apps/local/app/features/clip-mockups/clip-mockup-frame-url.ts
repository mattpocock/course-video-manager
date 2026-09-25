/**
 * Where the browser fetches a Clip Mockup's frame from.
 *
 * ONE function, so the Clip Mockup list never builds the URL itself: the
 * Animatic player (course-video-manager#1649) serves the same frames off the
 * same disk, and when the two surfaces land together this is the single line
 * that points both at one route.
 */
export function clipMockupFrameUrl(clipMockupId: string): string {
  return `/api/clip-mockups/${clipMockupId}/image`;
}
