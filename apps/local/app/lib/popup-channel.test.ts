import { afterEach, describe, expect, it, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { z } from "zod";
import {
  POPUP_ALIVE_WINDOW_MS,
  createPopupChannel,
  isPingFresh,
} from "./popup-channel";

describe("isPingFresh", () => {
  it("is false before the popup has ever pinged", () => {
    expect(isPingFresh(0, 60_000)).toBe(false);
  });

  it("is true for a ping inside the window", () => {
    // The popup pings every 2s, so anything within the window means it is there.
    expect(isPingFresh(10_000, 12_000)).toBe(true);
  });

  it("is false once the window has passed with nothing heard", () => {
    expect(isPingFresh(10_000, 10_000 + POPUP_ALIVE_WINDOW_MS)).toBe(false);
  });

  // A backwards clock step (NTP correcting mid-take) puts `now` behind the
  // ping. The popup is plainly still there, so this must not read as a
  // disconnect and blank the editor's status for a whole take. Rules out
  // "tidying" the elapsed check to an absolute difference.
  it("is true when the clock steps backwards after a ping", () => {
    expect(isPingFresh(10_000, 5_000)).toBe(true);
  });
});

// The browser is the system boundary here: `window.open` and the popup's
// Window are stubbed, and Node's own BroadcastChannel carries the messages for
// real.
const ToChild = z.discriminatedUnion("type", [
  z.object({ type: z.literal("load"), id: z.string() }),
]);
const ToParent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("saved"), id: z.string() }),
]);

let channelCount = 0;
const unsubs: Array<() => void> = [];

function setup() {
  const popup = { closed: false, focus: vi.fn() };
  const open = vi.fn(() => fromPartial<Window>(popup));
  vi.stubGlobal("window", { open });
  // A fresh name per test so tests never hear each other's traffic.
  const name = `test-popup-${++channelCount}`;
  const config = {
    name,
    url: "/popup",
    windowFeatures: "popup,width=10,height=20",
    toChild: ToChild,
    toParent: ToParent,
  };
  // Two instances on one channel name: the main app and the popup, as two
  // tabs would each make their own.
  const parent = createPopupChannel(config);
  const child = createPopupChannel(config);
  return { parent, child, popup, open, name };
}

function received<T>(
  subscribe: (handler: (message: T) => void) => () => void
): T[] {
  const seen: T[] = [];
  unsubs.push(subscribe((message) => seen.push(message)));
  return seen;
}

afterEach(() => {
  for (const unsub of unsubs.splice(0)) unsub();
  vi.unstubAllGlobals();
});

describe("createPopupChannel", () => {
  it("carries popup messages to the main app", async () => {
    const { parent, child } = setup();
    const seen = received(parent.subscribeParent);

    child.sendToParent({ type: "saved", id: "a" });

    await vi.waitFor(() => expect(seen).toEqual([{ type: "saved", id: "a" }]));
  });

  it("carries main-app messages to the popup", async () => {
    const { parent, child } = setup();
    const seen = received(child.subscribeChild);

    parent.sendToChild({ type: "load", id: "b" });

    await vi.waitFor(() => expect(seen).toEqual([{ type: "load", id: "b" }]));
  });

  it("gives each side only the messages meant for it", async () => {
    const { parent, child } = setup();
    const parentSeen = received(parent.subscribeParent);
    const childSeen = received(child.subscribeChild);

    parent.sendToChild({ type: "load", id: "x" });
    child.sendToParent({ type: "saved", id: "y" });

    await vi.waitFor(() => {
      expect(parentSeen).toEqual([{ type: "saved", id: "y" }]);
      expect(childSeen).toEqual([{ type: "load", id: "x" }]);
    });
  });

  it("is not open before the popup has pinged", () => {
    const { parent } = setup();
    expect(parent.isOpen()).toBe(false);
  });

  it("is open once the popup pings", async () => {
    const { parent, child } = setup();

    child.sendToParent({ type: "ping" });

    await vi.waitFor(() => expect(parent.isOpen()).toBe(true));
  });

  it("opens the popup under the channel name with its window features", () => {
    const { parent, open, name } = setup();

    parent.open();

    expect(open).toHaveBeenCalledWith(
      "/popup",
      name,
      "popup,width=10,height=20"
    );
  });

  it("opens a given url instead of the default", () => {
    const { parent, open } = setup();

    parent.open("/popup/42");

    expect(open).toHaveBeenCalledWith(
      "/popup/42",
      expect.any(String),
      expect.any(String)
    );
  });

  it("focuses the open popup instead of opening another", async () => {
    const { parent, child, open, popup } = setup();
    parent.open();
    child.sendToParent({ type: "ping" });
    await vi.waitFor(() => expect(parent.isOpen()).toBe(true));

    parent.open("/popup/ignored");

    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalledTimes(2);
  });

  it("is not open once the popup window is closed, even after a fresh ping", async () => {
    const { parent, child, popup } = setup();
    parent.open();
    child.sendToParent({ type: "ping" });
    await vi.waitFor(() => expect(parent.isOpen()).toBe(true));

    popup.closed = true;

    expect(parent.isOpen()).toBe(false);
  });
});
