import { afterEach, describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Fiber, TestClock } from "effect";
import { resolveDropboxUrl } from "./dropbox-fetch";
import { getMetadata } from "./dropbox-http-client";
import { createFakeDropbox } from "@/test-utils/fake-dropbox";

// A verification run points both Dropbox hosts at a local stub (verify-cvm
// sets them to a dead port unless the caller exports a loopback URL), so no
// Publish on a clone can reach the real Dropbox.
describe("resolveDropboxUrl", () => {
  it.effect("keeps Dropbox's own hosts when nothing is set", () =>
    Effect.gen(function* () {
      expect(
        yield* resolveDropboxUrl(
          "https://api.dropboxapi.com/2/files/list_folder"
        )
      ).toBe("https://api.dropboxapi.com/2/files/list_folder");
      expect(
        yield* resolveDropboxUrl(
          "https://content.dropboxapi.com/2/files/upload"
        )
      ).toBe("https://content.dropboxapi.com/2/files/upload");
    }).pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map())))
  );

  it.effect("sends each host where its variable says", () =>
    Effect.gen(function* () {
      expect(
        yield* resolveDropboxUrl(
          "https://api.dropboxapi.com/2/files/list_folder"
        )
      ).toBe("http://127.0.0.1:18790/2/files/list_folder");
      expect(
        yield* resolveDropboxUrl(
          "https://content.dropboxapi.com/2/files/upload_session/start"
        )
      ).toBe("http://127.0.0.1:18791/2/files/upload_session/start");
    }).pipe(
      Effect.withConfigProvider(
        ConfigProvider.fromMap(
          new Map([
            ["DROPBOX_API_URL", "http://127.0.0.1:18790/"],
            ["DROPBOX_CONTENT_URL", "http://127.0.0.1:18791"],
          ])
        )
      )
    )
  );
});

// A connection that dies without a word would otherwise hold a Publish open
// for ever: no request had a deadline (2026-10-20, Publish 2d1b2a55).
describe("a Dropbox request that never answers", () => {
  const dropbox = createFakeDropbox();
  afterEach(() => dropbox.cleanup());

  it.effect("is abandoned at its deadline and retried", () =>
    Effect.gen(function* () {
      dropbox.install();
      dropbox.store("/Courses/course.json", Buffer.from("{}"));
      dropbox.failNextRequests({
        match: (url) => url.endsWith("/files/get_metadata"),
        times: 1,
        network: "hang",
      });

      const fiber = yield* Effect.fork(
        getMetadata({ accessToken: "token", path: "/Courses/course.json" })
      );
      // Past the two-minute deadline, then past the first backoff.
      yield* TestClock.adjust("121 seconds");
      yield* TestClock.adjust("2 seconds");

      const metadata = yield* Fiber.join(fiber);
      expect(metadata).toMatchObject({ name: "course.json" });
      expect(dropbox.fetchCalls).toHaveLength(2);
      expect(dropbox.fetchCalls[0]!.init.signal?.aborted).toBe(true);
    })
  );
});
