/**
 * Anthropic prompt-caching breakpoints for the writing agents.
 *
 * A writing session re-sends the same 10k–26k tokens of transcript, code files
 * and screenshots on every request, and there are two requests per user
 * message because the client re-submits after applying each edit. Caching that
 * prefix is the difference between paying for it once and paying for it twenty
 * times.
 *
 * Anthropic builds the cache in a strict order — tools, then system, then
 * messages — and a change at any level invalidates that level and everything
 * after it. So the layout that matters is: put stable content first, put a
 * breakpoint at the end of it, and keep churning content strictly behind that
 * breakpoint. The writing agents are arranged to make that true.
 *
 * Only four breakpoints are allowed per request. The document writer spends
 * them on the system prompt, the screenshots, and the last two messages of the
 * conversation.
 */

/**
 * The one-hour breakpoint, for content that is stable across a whole session:
 * the system prompt and the screenshots.
 *
 * The five-minute default is wrong here. Writing sessions have long gaps —
 * Matt reads the draft, hand-edits it, and comes back — so a five-minute
 * entry would nearly always be cold. A one-hour write costs 2x base and a read
 * costs 0.1x, so it pays back after roughly one hit.
 *
 * Anthropic requires longer TTLs to appear ahead of shorter ones in the
 * prompt. The system-before-messages ordering guarantees that.
 */
export const CACHE_BREAKPOINT_1H = {
  anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
} as const;

/**
 * The five-minute breakpoint, for the conversation tail.
 *
 * The tail turns over within a single user message — the client applies each
 * edit and immediately re-submits — so it is read back in seconds and is never
 * worth the 2x write premium of a one-hour entry.
 */
export const CACHE_BREAKPOINT_5M = {
  anthropic: { cacheControl: { type: "ephemeral" } },
} as const;
