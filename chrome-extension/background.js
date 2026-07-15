// CVM Browser Link Capture — MV3 background service worker.
//
// A dumb event tap. It watches Chrome window focus and the active tab's URL and
// forwards state-change events to the Course Video Manager over the forwarder
// hub (ws://localhost:5172). The Video Editor reconstructs which pages were on
// screen during each recorded clip.
//
// Design notes:
//   * Send-only. We never receive from the hub.
//   * Best-effort. If the hub is down (CVM/OBS not running — the common case),
//     connects fail fast and events are dropped. No buffering, no retry storm.
//   * MV3 service workers sleep when idle; that's fine. Any focus/tab event
//     wakes the worker, which reconnects lazily and sends. During filming there
//     is enough activity to keep the socket alive.

const HUB_URL = "ws://localhost:5172";
// After a failed connect, don't try again for this long (avoids hammering the
// hub while CVM is closed and you're just browsing).
const RECONNECT_COOLDOWN_MS = 5000;
// Only the newest events matter; cap the tiny buffer used during the brief
// connect handshake.
const MAX_PENDING = 10;

let socket = null;
let connecting = false;
let lastConnectFailAt = 0;
let pending = [];

function setConnectedBadge(connected) {
  chrome.action.setBadgeBackgroundColor({
    color: connected ? "#16a34a" : "#9ca3af",
  });
  chrome.action.setBadgeText({ text: connected ? "on" : "" });
  chrome.action.setTitle({
    title: connected
      ? "CVM Link Capture: connected"
      : "CVM Link Capture: not connected",
  });
}

function ensureConnected() {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  if (connecting) return;
  if (Date.now() - lastConnectFailAt < RECONNECT_COOLDOWN_MS) return;

  connecting = true;
  let ws;
  try {
    ws = new WebSocket(HUB_URL);
  } catch {
    connecting = false;
    lastConnectFailAt = Date.now();
    return;
  }

  ws.addEventListener("open", () => {
    socket = ws;
    connecting = false;
    setConnectedBadge(true);
    const toFlush = pending;
    pending = [];
    for (const msg of toFlush) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // ignore
      }
    }
  });

  const onGone = () => {
    if (socket === ws) socket = null;
    connecting = false;
    lastConnectFailAt = Date.now();
    pending = [];
    setConnectedBadge(false);
  };
  ws.addEventListener("close", onGone);
  ws.addEventListener("error", onGone);
}

function send(message) {
  ensureConnected();
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // ignore
    }
    return;
  }
  // Socket is mid-handshake (or just woke up): keep only the newest events so
  // they flush once open. If the connect fails, pending is cleared.
  pending.push(message);
  if (pending.length > MAX_PENDING) pending.shift();
}

function sendFocus(focused) {
  send({ type: "browser-focus", focused, ts: Date.now() });
}

function sendUrl(url, title) {
  if (typeof url !== "string" || url === "") return;
  send({
    type: "browser-url",
    url,
    ...(typeof title === "string" && title !== "" ? { title } : {}),
    ts: Date.now(),
  });
}

// The active tab of the last-focused normal window.
async function sendActiveTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tab) sendUrl(tab.url, tab.title);
  } catch {
    // ignore
  }
}

// Chrome gained/lost OS focus. WINDOW_ID_NONE means no Chrome window is focused
// (you tabbed away to another app, e.g. the CVM in Edge).
chrome.windows.onFocusChanged.addListener((windowId) => {
  const focused = windowId !== chrome.windows.WINDOW_ID_NONE;
  sendFocus(focused);
  // On regaining focus, resend the current URL so the editor's effective-visible
  // state is correct even if the active tab changed while Chrome was in the
  // background.
  if (focused) sendActiveTabUrl();
});

// Switched to a different tab.
chrome.tabs.onActivated.addListener(() => {
  sendActiveTabUrl();
});

// The active tab navigated to a new URL (or its title resolved).
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || changeInfo.title) {
    sendUrl(tab.url, tab.title);
  }
});

setConnectedBadge(false);
