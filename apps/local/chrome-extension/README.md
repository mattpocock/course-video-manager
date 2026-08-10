# CVM Browser Link Capture

A tiny Chrome extension that captures the web pages you show on screen while
recording, so they get attached to the right clips in the Course Video Manager.

## Why it exists

Matt films with the **CVM open in Edge** on one side and a **Chrome browser** on
the other showing reference pages. Because the two live in different browsers, an
in-page link can't bridge them — so this extension streams the focused Chrome
tab's URL to CVM over the **forwarder hub WebSocket** (`ws://localhost:5172`,
the same hub the Stream Deck uses).

The extension is a **dumb event tap**. It emits two kinds of message:

- `browser-focus` — when the Chrome window gains/loses OS focus.
- `browser-url` — when the active tab's URL changes (tab switch or navigation).

CVM's Video Editor reconstructs, from that stream, which pages were on screen
(Chrome focused + a real web page) during each recorded clip, and stores them as
`clip_web_link` rows. They then show as chips under each clip and are annotated
inline in the transcript handed to the writer agent.

## Design guarantees

- **Send-only.** It never receives anything from the hub.
- **Best-effort.** If CVM/OBS isn't running (the usual case while you browse),
  connections fail fast and events are dropped — no buffering, no retry storm,
  no degradation to normal browsing.
- **Self-healing.** MV3 service workers sleep when idle; any focus/tab event
  wakes it and it reconnects lazily. During filming there's enough activity to
  keep the socket alive.

The toolbar badge shows **`on`** (green) when connected to the hub and nothing
when disconnected — glance at it before a shoot.

## Install (unpacked, dev-only)

This is a personal tool — not published to the Chrome Web Store.

1. Open `chrome://extensions` in the **Chrome** browser you film with.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this `chrome-extension/` directory.
4. Pin the extension so you can see its badge.

Config is hardcoded to `ws://localhost:5172` (matches the rest of the CVM
localhost stack). If that ever changes, edit `HUB_URL` in `background.js`.

## Smoke test (≈2 minutes)

Do this after loading/updating the extension, before relying on it in a shoot:

1. Start CVM (`pnpm dev`) so the forwarder hub is listening on `:5172`.
2. Reload the extension at `chrome://extensions`. Its badge should turn to a
   green **`on`** within a second or two. (If it stays blank, the hub isn't up.)
3. Open the CVM video editor for any video in Edge.
4. Start an OBS recording and talk for a few seconds while a Chrome tab
   (e.g. `https://example.com`) is focused. Switch to a second page and talk
   about it too.
5. Stop recording. Once the clips land, confirm:
   - Link **chips** appear under the clips where those pages were focused.
   - Flipping a page for under ~1.5s does **not** create a chip.
   - Tabbing away to Edge (Chrome loses focus) stops capture.
6. Open the article writer and confirm the transcript shows
   `«on screen: … — https://…»` inline after the relevant `[N]` markers, each
   URL annotated only once.

### Testing the CVM side without a browser

You don't need Chrome to exercise the editor half — run the synthetic event
sender, which pushes fake `browser-focus` / `browser-url` messages onto the hub:

```sh
pnpm tsx chrome-extension/dev-send-events.ts
```

See that script's header for options.
