/**
 * Whether the playground's window is already full screen, in either of the
 * two ways a browser can be: the Fullscreen API (`requestFullscreen`), or the
 * browser's own full screen (F11), which leaves `document.fullscreenElement`
 * null. Asking for full screen again while in either re-shows the browser's
 * "press Esc / F11 to exit" notice, which must never appear over a take.
 */
export interface FullScreenView {
  /** `document.fullscreenElement !== null`. */
  hasFullscreenElement: boolean;
  /** `matchMedia("(display-mode: fullscreen)").matches` — F11 in Chromium. */
  displayModeFullScreen: boolean;
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
}

export function isFullScreen(view: FullScreenView): boolean {
  if (view.hasFullscreenElement || view.displayModeFullScreen) return true;
  // F11 where display-mode isn't reported: the page fills the whole screen,
  // with no browser chrome or taskbar left around it.
  return (
    view.innerWidth >= view.screenWidth && view.innerHeight >= view.screenHeight
  );
}

/** Reads `FullScreenView` from the live window. */
export function readFullScreen(): boolean {
  if (typeof window === "undefined") return false;
  return isFullScreen({
    hasFullscreenElement: document.fullscreenElement !== null,
    displayModeFullScreen: window.matchMedia("(display-mode: fullscreen)")
      .matches,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  });
}

/**
 * The browser allows `requestFullscreen()` without a user gesture only for an
 * origin granted Automatic Fullscreen — in Chrome and Edge, through the
 * `AutomaticFullscreenAllowedForUrls` policy. A recording starts in another
 * window (or in OBS), so there is never a gesture here to borrow.
 */
export const FULL_SCREEN_REFUSED_HINT =
  "The browser refused to put the diagram playground full screen. Add this origin to the AutomaticFullscreenAllowedForUrls policy to let it go full screen when a recording starts.";
