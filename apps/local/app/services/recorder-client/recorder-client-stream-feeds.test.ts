import { describe, expect, it } from "vitest";
import { Either } from "effect";
import type { Launch } from "recorder-service/launcher";
import {
  isStream,
  isStreamedWriter,
  ports,
  ready,
  setupGoLiveTests,
} from "./go-live-test-harness";

/**
 * THE LIVE STREAM'S FEEDS (#2502), end to end through Go Live: what the
 * streamed camera writer sends the stream, and how the stream reads it. On
 * Matt's real take the one raw 1440p camera + mic feed overflowed, then
 * died, and took the stream's only sound with it while the picture froze.
 */

setupGoLiveTests();

type Ffmpeg = Extract<Launch, { tool: "ffmpeg" }>;

/** Each output of an ffmpeg command line: what it maps, and where it goes. */
const outputs = (args: readonly string[]) => {
  const found: { maps: string[]; to: string }[] = [];
  let maps: string[] = [];
  args.forEach((a, i) => {
    if (args[i - 1] === "-map") maps.push(a);
    const target =
      /\.mkv$/.test(a) || /\]tcp:\/\/127\.0\.0\.1:\d+\?timeout/.test(a);
    if (maps.length > 0 && target) {
      found.push({ maps, to: a });
      maps = [];
    }
  });
  return found;
};

const launches = async () => {
  const r = await ready();
  expect(Either.isRight(await r.goLive())).toBe(true);
  const writer = r.windows.launched.find(isStreamedWriter) as Ffmpeg;
  const stream = r.windows.launched.find(isStream) as Ffmpeg;
  return { r, writer: writer.args, stream: stream.args };
};

describe("the Live Stream's feeds", () => {
  it("sends the mic on a feed of its own, so the sound never goes with the camera", async () => {
    const { r, writer, stream } = await launches();

    // Screen, camera, mic: three inputs the stream listens for.
    const [screenPort, cameraPort, micPort] = ports(
      stream,
      /tcp:\/\/127\.0\.0\.1:(\d+)\?listen=1/g
    );
    expect(new Set([screenPort, cameraPort, micPort]).size).toBe(3);
    const feeds = outputs(writer).filter((o) => o.to.includes("tcp://"));
    const to = (port: number | undefined) =>
      feeds.find((o) => o.to.includes(`:${port}?`))?.maps;
    expect(to(cameraPort)).toEqual(["[streamcam]"]);
    expect(to(micPort)).toEqual(["[streammic]"]);
    // Its sound is the mic feed's, input 2; nothing reads the camera's.
    const graph = stream.join(" ");
    expect(graph).toMatch(/\[2:a\][^;]*\[a\]/);
    expect(graph).not.toContain("[1:a]");
    await r.client.endStream(r.video.id);
  });

  it("sends the camera scaled on the GPU to the most any scene draws of it, the Camera scene's 1920x1080, and camera.mkv as ever", async () => {
    const { r, writer, stream } = await launches();
    const graph = writer[writer.indexOf("-filter_complex") + 1]!;

    const branch = graph.match(/\[streamcam_raw\]([^;]*)\[streamcam\]/)?.[1];
    expect(branch).toMatch(
      /^hwupload_cuda,scale_cuda=1920:1080[^,]*,hwdownload,format=nv12$/
    );
    // camera.mkv's branch takes the very frames it took before.
    expect(graph).toMatch(/split\[cam\]\[streamcam_raw\]/);
    expect(outputs(writer).find((o) => o.to === "camera.mkv")?.maps).toEqual([
      "[cam]",
    ]);
    // The stream crops from a 1920x1080 camera: the Camera scene takes it
    // 1:1 (less the 2 px it sits in by), Code its 0.370833 x 0.961111 at
    // 0.31875.
    expect(stream.join(" ")).toContain(
      "crop=w=1918:h=1078:x=0:y=0,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,hwupload_cuda,scale_cuda=1918:1078"
    );
    expect(stream.join(" ")).toContain("crop=w=712:h=1038:x=612:y=0");
    await r.client.endStream(r.video.id);
  });

  it("ends the picture with any feed that ends, so the stream side hears a dead feed as a stall and launches it again", async () => {
    const { r, stream } = await launches();
    const graph = stream.join(" ");

    // Every camera overlay ends the picture, as the screen's do.
    expect(graph).not.toContain("eof_action=repeat");
    const overlays = graph.match(/overlay_cuda=[^[]*/g) ?? [];
    expect(overlays.length).toBeGreaterThan(0);
    for (const o of overlays) expect(o).toContain("eof_action=endall");
    // The sound ending ends the picture too.
    expect(stream).toContain("-shortest");
    await r.client.endStream(r.video.id);
  });
});
