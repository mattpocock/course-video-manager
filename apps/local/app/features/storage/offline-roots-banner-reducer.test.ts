import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialOfflineRootsBannerState,
  offlineRootsBannerReducer,
  offlineRootsShown,
} from "./offline-roots-banner-reducer";

const e = { root: "/mnt/e", message: "E: is offline", remountCommand: null };
const f = { root: "/mnt/f", message: "F: is offline", remountCommand: null };

const banner = () =>
  new ReducerTester(
    offlineRootsBannerReducer,
    createInitialOfflineRootsBannerState()
  );

describe("the Offline Storage Roots banner", () => {
  it("shows every Offline Storage Root until dismissed", () => {
    const t = banner();
    expect(offlineRootsShown(t.getState(), [e])).toEqual([e]);

    t.send({ type: "banner-dismissed", roots: ["/mnt/e"] });
    expect(offlineRootsShown(t.getState(), [e])).toEqual([]);
  });

  it("comes back when another Storage Root goes offline after the dismissal", () => {
    const t = banner().send({ type: "banner-dismissed", roots: ["/mnt/e"] });
    expect(offlineRootsShown(t.getState(), [e, f])).toEqual([e, f]);
  });

  it("stays hidden when a dismissed Storage Root comes back online", () => {
    const t = banner().send({
      type: "banner-dismissed",
      roots: ["/mnt/e", "/mnt/f"],
    });
    expect(offlineRootsShown(t.getState(), [f])).toEqual([]);
  });

  it("comes back for a Storage Root that came back and then went offline again", () => {
    const t = banner()
      .send({ type: "banner-dismissed", roots: ["/mnt/e"] })
      .send({ type: "offline-roots-heard", roots: [] });
    expect(offlineRootsShown(t.getState(), [e])).toEqual([e]);
  });
});
