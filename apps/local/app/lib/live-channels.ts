/**
 * The live channel on Matt's desk the browser connects to: the Stream Deck
 * forwarder hub (Stream Deck presses, teleprompter controls, browser
 * link-capture). Every client reads its address from here, never from a
 * literal.
 *
 * The address is decided at build time by vite.config.ts (see
 * live-desk/live-desk.ts): the live desk in Matt's main checkout, the discard
 * port everywhere else, and an explicit `VITE_STREAM_DECK_HUB_URL` over both —
 * verify-cvm pins its runs that way. A worktree's editor therefore never hears
 * Matt's real button presses, and his editor never hears it. The fallback here
 * is the dead address too, so a build that skipped the config still fails
 * closed.
 */
export const STREAM_DECK_HUB_URL: string =
  import.meta.env.VITE_STREAM_DECK_HUB_URL || "ws://127.0.0.1:9";
