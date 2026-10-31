---
status: accepted
---

# Go Live records; a streamed Recording Session survives leaving the page

Decided on 2026-10-30 (spec #2445, built in #2460). It amends [ADR 0050](0050-one-recording-session-reducer-two-effect-sets.md) point 4 for **Streamed Recording Sessions** only, and extends [ADR 0054](0054-the-live-stream-is-its-own-process-fed-by-the-recording-sessions-writers.md).

## Context

ADR 0050 point 4 stops a recording whenever the page that follows it goes away (a refresh, closing the tab, any other page), and stops a recording the page first hears of but doesn't follow. That keeps a take from running on with nobody watching. A Live Stream is different. It always runs with exactly one Recording Session, which it starts and stops (ADR 0054 point 4), so stopping that Recording Session ends the Live Stream too. Matt: the stream survives leaving the Streaming tab ("it's global state"), and streams start only from the Streaming tab, never from the editor or the Stream Deck.

## Decision

1. **Only End Stream ends a Streamed Recording Session.** Leaving, refreshing or closing the Streaming tab hands nothing back to the recorder (`followedOnLeave` is null for it). A page that first hears of it, such as the Streaming tab on return or after a refresh, re-attaches to it and stops nothing (`recorderSessionReducer`, the `streamed` flag on `recorder-reported`). A Recording Session that is not streamed keeps ADR 0050 point 4 exactly.
2. **The recorder service is busy streaming while live** (`go-live.ts`, from Go Live until its Recording Session ends). It refuses `stop`, `close` and `open` with `BUSY_STREAMING`. Its busy check counts live, so it refuses the app server's idle stop (ADR 0053 point 3). This holds whatever the app or the browser does, so it is the backstop for point 1.
3. **Another Video's editor is told the recorder is busy streaming.** The recorder client says so in its `recorder-status` `problem`, so that editor can't record, open the recorder or stop it.
4. **The Stream Deck's Record and Stop do nothing while live.** Each becomes `stream-deck-ignored` with the reason. Scene keys still act, and delete still archives a Take, because the editor handles delete and never sends it to the recorder service. No Stream Deck key starts a stream.
5. **A Live indicator shows on every page while live.** It links back to the live Video's Streaming tab. The app root reads the recorder client's Live Stream on each page load (`liveStream()`, through `existingRecorderClient`, which opens no socket). The Streaming tab feeds the same Live Stream surface as its recorder hears it. (Amended 2026-10-31, below: the indicator now follows the Live Stream as it changes.)

## Consequences

- ADR 0053's keep-awake rules still hold, because a Live Stream is always recording. The editor never lets the recorder go while its Recording Session records, and now also from Go Live (`holdsRecordingSession` counts a Live Stream that is on). The service's idle stop is refused while live.
- The Live indicator adds no long-lived connection: each browser window shares six connections to the app. It is up to date on each page load and on the Streaming tab. A Live Stream that ends on its own while Matt is on another page shows as ended on the next page load.
- Until #2459 relaunches a stream process that quits, the Live Stream can show as ended while its Recording Session still records. The service still treats that Recording Session as streamed (point 2), so only End Stream stops it.

## Amendment (2026-10-31, code review of #2445)

Point 5 and its consequence change. A Live Stream that ended on its own (the camera lost) left the indicator up on every other page until the next page load. Now:

- **The recorder client says each change of the Live Stream** to the app server (`onLiveStreamChanged`, `recorder-watch.ts`). The app server sends it to each tab as a `live-stream-changed` event on the tab's existing app-wide stream, `/api/jobs/events`, at connect and at each change (`features/streaming/live-stream-wire.ts`). There is still no new long-lived connection. The Sidecar's own events are passed on whole, so one never splits another.
- **The Live Stream surface takes its status only from that one fact** (`live-stream-heard`). The app root no longer reads `liveStream()` in its loader, and the Streaming tab no longer copies its recorder's status into the surface. The health line reads the tab's own recorder state, which forgets an ended stream's health.
- **The Broadcast chat stops whenever the streamed Recording Session ends**, however it ends (`onStreamedSessionEnded`), not only through the End Stream route.
