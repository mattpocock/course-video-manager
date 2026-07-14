# Clip Web Links captured over the Stream Deck WebSocket hub

A **Clip Web Link** records that a web page was on screen (in a focused Chrome window, showing an `http(s)` page) while a **Clip** was being recorded. Matt films with the CVM open in **Edge** and reference pages in a separate **Chrome** browser. A dumb MV3 Chrome extension (`chrome-extension/`) streams two event types — `browser-focus` and `browser-url` — over the existing Stream Deck forwarder **WebSocket** hub (`ws://localhost:5172`). The Video Editor reconstructs the effective-visible-URL timeline from that stream and attaches the pages shown during each clip.

The capture rides the **Optimistic Clip** lifecycle exactly as diagram pinning does (see ADR 0003–0005): the clip's window opens when speech is detected and drains when its audio window closes; the drained links are stashed on the optimistic clip and persisted as `clip_web_link` rows when it pairs with a database clip. No source-time arithmetic — the live wall-clock window is the association.

## Why WebSocket here, when ADR 0005 rejected it for diagrams

ADR 0005 chose `BroadcastChannel` for the Diagram Playground ↔ Video Editor link and rejected WebSocket, but named the exact conditions under which WebSocket _would_ be right: _"if editor and playground could live on different machines or if the server itself needed to push … — neither is true today."_

For Clip Web Links the first condition holds. The two endpoints are **different browsers** (Edge and Chrome) — different processes, different origins. `BroadcastChannel` is same-origin, same-user-agent; it cannot bridge Edge↔Chrome. So the reasoning of ADR 0005 points _at_ WebSocket here, not away from it. And the transport already exists: the Stream Deck forwarder is a broadcast hub that rebroadcasts any client's message to all clients, so the extension is just another producer and the editor just another consumer.

## Considered alternatives

- **`BroadcastChannel` (as diagrams use).** Impossible: it does not cross the Edge↔Chrome browser boundary. This is the constraint ADR 0005 flagged.
- **A dedicated WebSocket server/port for browser events.** Rejected: a second server to run and a second thing that can be down, for no benefit — the forwarder hub already fans out client messages. Reuse keeps one lifecycle.
- **A native-messaging host / file drop / clipboard bridge.** Rejected: heavier to install and operate than an unpacked extension pointed at a localhost socket the stack already runs.

## Consequences

- The forwarder message schema (`stream-deck-forwarder/stream-deck-forwarder-types.ts`) now carries two message families — Stream Deck actions and browser events — as separate schemas over the same hub. Consumers that care about only one family must **ignore unknown types gracefully** (`use-websocket.ts` now `safeParse`s and drops non-Stream-Deck messages) instead of throwing.
- The extension is **send-only and best-effort**: when the hub is down (CVM/OBS not running — the common case while browsing) connects fail fast and events are dropped, so normal browsing never degrades. It tolerates the hub, the browser, and OBS each being absent.
- Capture is **live-only, going forward** — there is no backfill of links for already-recorded clips.
