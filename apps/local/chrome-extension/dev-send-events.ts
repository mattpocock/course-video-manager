// Synthetic browser link-capture event sender.
//
// Pushes fake `browser-focus` / `browser-url` messages onto the forwarder hub
// (ws://localhost:5172) so you can exercise the CVM side of the link-capture
// feature without loading the Chrome extension or driving a real browser.
//
// Usage:
//   pnpm tsx chrome-extension/dev-send-events.ts
//   pnpm tsx chrome-extension/dev-send-events.ts https://a.com https://b.com
//
// It walks through a small scripted scenario: focus Chrome, show the first URL,
// switch to the second, then blur — the same shape the extension emits while you
// narrate over two reference pages. Run it with the CVM dev server up; watch the
// video editor's link event log / recorded clips react.
//
// Note: attaching links to clips still requires a recording (OBS drives clip
// creation). This script verifies the extension -> hub -> editor event path.

import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createBrowserEventMessage,
  type BrowserEventMessage,
} from "../stream-deck-forwarder/stream-deck-forwarder-types";
import { isMainCheckout } from "../live-desk/live-desk";
import { log } from "@/packages/log";

const HUB_URL = "ws://localhost:5172";

const urls =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ["https://example.com/one", "https://example.com/two"];

async function main() {
  // The hub is Matt's live desk: these events would land in his editor. Only
  // his main checkout may send to it (see live-desk/live-desk.ts).
  if (!isMainCheckout(process.cwd())) {
    log.error(
      `Refusing to send to ${HUB_URL}: this is not the main checkout, and that hub is Matt's live desk.`
    );
    process.exit(1);
  }
  const ws = new WebSocket(HUB_URL);
  ws.addEventListener("error", () => {
    log.error(
      `Could not connect to the forwarder hub at ${HUB_URL}. Is the CVM dev server running?`
    );
    process.exit(1);
  });
  await once(ws, "open");
  log.info(`Connected to ${HUB_URL}`);

  const emit = (message: BrowserEventMessage) => {
    ws.send(createBrowserEventMessage(message));
    log.info("→", JSON.stringify(message));
  };

  emit({ type: "browser-focus", focused: true, ts: Date.now() });
  for (const url of urls) {
    emit({ type: "browser-url", url, ts: Date.now() });
    await sleep(3000);
  }
  emit({ type: "browser-focus", focused: false, ts: Date.now() });

  await sleep(200);
  ws.close();
  log.info("Done.");
  process.exit(0);
}

void main();
