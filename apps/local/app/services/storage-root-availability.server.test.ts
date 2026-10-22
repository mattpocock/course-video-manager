import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeStorageRootAvailability } from "./storage-root-availability.server";

describe("Storage Root availability", () => {
  it("names an Offline root, checks at most once per ttl, and logs only each change", async () => {
    const offline = new Set(["/roots/e"]);
    let now = 0;
    let checks = 0;
    const log: string[] = [];
    const availability = makeStorageRootAvailability({
      isOnline: (root) =>
        Effect.sync(() => {
          checks++;
          return !offline.has(root);
        }),
      now: () => now,
      log: (line) => log.push(line),
      ttlMs: 1000,
    });
    const roots = ["/roots/d", "/roots/e"];
    const check = () => Effect.runPromise(availability.offlineRoots(roots));

    expect(await check()).toEqual([
      {
        root: "/roots/e",
        message:
          "Storage Root /roots/e is offline — reconnect it, then remount /roots/e",
      },
    ]);
    now = 500;
    await check();
    expect(checks).toBe(2);

    now = 1500;
    await check();
    offline.clear();
    now = 3000;
    expect(await check()).toEqual([]);

    expect(log).toEqual([
      "[storage] Storage Root /roots/e is offline — reconnect it, then remount /roots/e",
      "[storage] Storage Root /roots/e is back online",
    ]);
  });
});
