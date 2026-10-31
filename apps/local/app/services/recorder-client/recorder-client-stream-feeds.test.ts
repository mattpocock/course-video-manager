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

/** Where the writer's tee sends `file`'s packets, besides the file itself. */
const teedTo = (args: readonly string[], file: string) =>
  args
    .find((a) => a.includes(`]${file}|`))
    ?.match(/\]tcp:\/\/127\.0\.0\.1:(\d+)\?timeout/)?.[1];

const launches = async () => {
  const r = await ready();
  expect(Either.isRight(await r.goLive())).toBe(true);
  const writer = r.windows.launched.find(isStreamedWriter) as Ffmpeg;
  if (!writer) throw new Error("no streamed writer");
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
    expect(Number(teedTo(writer, "camera.mkv"))).toBe(cameraPort);
    expect(Number(teedTo(writer, "mic.mkv"))).toBe(micPort);
    // Its sound is the mic feed's, input 2.
    const graph = stream.join(" ");
    expect(graph).toMatch(/\[2:a\][^;]*\[a\]/);
    expect(graph).not.toContain("[1:a]");
    await r.client.endStream(r.video.id);
  });

  it("sends camera.mkv's and mic.mkv's own encoded packets, never a raw picture or a second encode, and decodes and crops the camera on the GPU", async () => {
    const { r, writer, stream } = await launches();

    // One encoder per file, as an unstreamed take has; no raw output.
    expect(writer.filter((a) => a === "h264_nvenc")).toHaveLength(1);
    expect(writer.filter((a) => a === "aac")).toHaveLength(1);
    expect(writer).not.toContain("rawvideo");
    expect(writer.join(" ")).not.toMatch(/split\[cam\]|asplit=3/);
    // The camera input is decoded on NVDEC.
    const camera = stream.findIndex((a) =>
      a.includes(
        `:${ports(stream, /tcp:\/\/127\.0\.0\.1:(\d+)\?listen=1/g)[1]}?listen=1`
      )
    );
    // Its own options: from the input before it (the screen's) to it.
    const screen = stream.findIndex((a) => a.includes("?listen=1"));
    const own = stream.slice(screen + 1, camera);
    expect(own[own.indexOf("-hwaccel") + 1]).toBe("cuda");
    expect(own[own.indexOf("-hwaccel_output_format") + 1]).toBe("cuda");
    // Cropped on CUDA, once per scene, never uploaded again.
    const graph = stream.join(" ");
    expect(graph).toContain("crop=w=948:h=1384:x=816:y=0,scale_cuda=490:716");
    expect(graph.match(/hwupload_cuda/g)).toHaveLength(2);
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
