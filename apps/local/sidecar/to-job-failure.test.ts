import { SystemError } from "@effect/platform/Error";
import { Cause } from "effect";
import { describe, expect, it } from "vitest";
import { toJobFailure } from "./sidecar";

describe("toJobFailure", () => {
  it("fails a Job that needs an Offline Storage Root naming the drive, not ENODEV", () => {
    const enodev = new SystemError({
      reason: "Unknown",
      module: "FileSystem",
      method: "open",
      pathOrDescriptor: "/mnt/e/finished-videos/a.mp4",
      cause: Object.assign(new Error("ENODEV: no such device"), {
        code: "ENODEV",
      }),
    });

    const failure = toJobFailure(Cause.fail(enodev), ["/mnt/d", "/mnt/e"]);

    expect(failure.tag).toBe("StorageRootOfflineError");
    expect(failure.message).toBe(
      "Storage Root /mnt/e is offline — reconnect drive E:, then remount /mnt/e"
    );
    expect(failure.cause).toContain("ENODEV");
  });
});
