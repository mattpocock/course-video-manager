/**
 * Where the browser fetches a Clip Mockup's two files from.
 *
 * ONE function per asset, so no surface builds either URL itself: the
 * Animatic player (course-video-manager#1649) reads both files off the disk
 * through the same `/api/clip-mockups/:id/:asset` route. Those routes were
 * briefly written twice; these two lines are what keeps them from being NAMED
 * twice.
 */
export function clipMockupFrameUrl(clipMockupId: string): string {
  return `/api/clip-mockups/${clipMockupId}/image`;
}

/** The spoken line's WAV. Range-served, so the Animatic's scrub bar can seek. */
export function clipMockupAudioUrl(clipMockupId: string): string {
  return `/api/clip-mockups/${clipMockupId}/audio`;
}
