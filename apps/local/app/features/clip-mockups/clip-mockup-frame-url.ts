/**
 * Where the browser fetches a Clip Mockup's two files from.
 *
 * ONE function per asset, so no surface builds either URL itself: the Clip
 * Mockup list in the video editor (course-video-manager#1650) and the Animatic
 * player (#1649) serve the same files off the same disk, through the same
 * `/api/clip-mockups/:id/:asset` route. Those routes were briefly written
 * twice; these two lines are what keeps them from being NAMED twice.
 */
export function clipMockupFrameUrl(clipMockupId: string): string {
  return `/api/clip-mockups/${clipMockupId}/image`;
}

/** The spoken line's WAV. Range-served, so the Animatic's scrub bar can seek. */
export function clipMockupAudioUrl(clipMockupId: string): string {
  return `/api/clip-mockups/${clipMockupId}/audio`;
}
