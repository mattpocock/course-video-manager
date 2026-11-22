import { expect, test } from "vitest";
import { watchLatestFrame } from "./latest-frame";
// What the service sent a browser for ten frames of a 160x90 test picture
// through the real `previewOutput` (libx264 -> FLV -> `preview-feeds.ts`).
import stream from "./test-fixtures/preview-stream-160x90.bin?url";
import { delay } from "@/packages/clock";

test("decodes a preview stream with WebCodecs at full size, skipping a burst it cannot decode at once (#2192)", async () => {
  const sizes: string[] = [];
  const stop = watchLatestFrame(stream, (frame) => {
    sizes.push(`${frame.displayWidth}x${frame.displayHeight}`);
    frame.close();
  });
  await expect.poll(() => sizes.length).toBeGreaterThan(0);
  // All ten frames come at once here: it decodes the first few and skips the
  // rest rather than queue them (it waits before asking again).
  await delay(300);
  stop();
  expect(sizes.length).toBeLessThan(10);
  expect(new Set(sizes)).toEqual(new Set(["160x90"]));
});
