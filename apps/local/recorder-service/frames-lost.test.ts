import { describe, expect, it } from "vitest";
import { countFramesLost } from "./frames-lost";

const counter = (now = { file: 0, picture: 0 }) =>
  countFramesLost({
    screenCaptured: true,
    fileTime: () => now.file,
    pictureTime: () => now.picture,
    tell: () => {},
  });

describe("where in the take frames were lost (#2227)", () => {
  it("places a gap from the frame before it, as the gap filter logs it", () => {
    const lost = counter();
    lost.screenLine("[Eval @ 0] [warning] 12.500000");
    lost.screenLine("[Eval @ 0] [warning] -0.100000");
    expect(lost.spans()).toEqual([
      { picture: "screen", from: 12.5, to: 12.6, frames: 5 },
    ]);
    expect(lost.totals()).toEqual({ camera: 0, screen: 5 });
  });

  it("merges losses of one picture less than a second apart, and keeps the pictures apart", () => {
    const now = { file: 0, picture: 30 };
    const lost = counter(now);
    lost.writerLine("[warning] 0.200000");
    lost.writerLine("[warning] -0.300000");
    lost.writerLine("[warning] 1.000000");
    lost.writerLine("[warning] -0.200000");
    lost.screenLine("[warning] 0.300000");
    lost.screenLine("[warning] -0.100000");
    // A dshow drop has no frame time: stamped with the clock's.
    lost.captureLine(
      "[dshow @ 1] [warning] real-time buffer [Cam Link 4K] [video input] too full! frame dropped!"
    );
    expect(lost.spans()).toEqual([
      { picture: "camera", from: 0.2, to: 1.2, frames: 13 },
      { picture: "screen", from: 0.3, to: 0.4, frames: 5 },
      { picture: "camera", from: 30, to: 30, frames: 1 },
    ]);
    expect(lost.totals()).toEqual({ camera: 14, screen: 5 });
  });

  it("falls back to the file's time for a gap logged with no start", () => {
    const lost = counter({ file: 7, picture: 7.2 });
    expect(lost.writerLine("[warning] -0.500000")).toBe(true);
    expect(lost.spans()).toEqual([
      { picture: "camera", from: 6.5, to: 7, frames: 14 },
    ]);
  });
});
