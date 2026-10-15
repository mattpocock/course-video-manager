import { describe, expect, it } from "vitest";
import {
  cameraCaptureArgs,
  cameraPreviewArgs,
  micAnchor,
  previewOutput,
  screenPreviewArgs,
} from "./capture-args";
import { BT709, SCREEN_TO_NV12 } from "./colour";
import {
  cameraWriterArgs,
  screenRecorderArgs,
  takeStartCommand,
} from "./take-args";

const relays = { preview: 23000, writer: 23001 };

const capture = () =>
  cameraCaptureArgs({ camera: "Cam Link 4K", mic: "Mic", relays });

const writer = () =>
  cameraWriterArgs({
    relayPort: relays.writer,
    tag: "t",
    silenceLength: "short",
    thresholdDb: -40,
  });

/** A filter graph's chains: split on the `;` between them, not those quoted in an expression. */
const graphOf = (args: readonly string[]) =>
  args[args.indexOf("-filter_complex") + 1]!.split(/;(?=\[)/);

describe("the camera capture (#2207)", () => {
  it("holds the Cam Link and the mic and encodes nothing: the picture goes raw to the preview's relay and the writer's, the mic to the writer's", () => {
    const args = capture().join(" ");
    expect(args).toContain("video=Cam Link 4K");
    expect(args).toContain("audio=Mic");
    expect(args).not.toMatch(/h264_nvenc|libx264|mjpeg|aac/);
    expect(graphOf(capture())).toEqual([
      "[0:v]hwupload_cuda,scale_cuda=2560:1440:interp_algo=bicubic,hwdownload,format=nv12,split[prev][rec]",
      `${micAnchor()}[mic]`,
    ]);
    // Each relay drops and retries rather than wait: a consumer gone or
    // stalled never holds up the capture, or the other relay.
    // Neither is NUT, whose muxer takes the capture down when a consumer
    // comes back (#2211): the writer's is Matroska, the preview's bare frames.
    expect(args).toContain(
      `[f=rawvideo:onfail=ignore]tcp://127.0.0.1:${relays.preview}?timeout=2000000&tcp_nodelay=1|[f=null:use_fifo=0]-`
    );
    expect(args).toContain(
      `[f=matroska:onfail=ignore]tcp://127.0.0.1:${relays.writer}?timeout=2000000&tcp_nodelay=1|[f=null:use_fifo=0]-`
    );
    expect(args.match(/drop_pkts_on_overflow=1/g)).toHaveLength(2);
  });

  it("relays the frames as they come: wall-clock stamps to the 100 ns, no frame-threaded encoder holding one back", () => {
    const args = capture().join(" ");
    expect(args).toContain("-copyts");
    expect(
      args.match(/-enc_time_base:v filter -c:v rawvideo -threads:v 1/g)
    ).toHaveLength(2);
    // A take must never drop a frame: DirectShow may hold about four seconds.
    const argv = capture();
    expect(argv[argv.indexOf("-rtbufsize") + 1]).toBe("1500M");
  });
});

describe("the camera preview (#2207)", () => {
  it("listens for the capture's preview relay and streams it, the same process recording or not", () => {
    const preview = cameraPreviewArgs({
      relayPort: relays.preview,
      port: 9,
      stillPort: 10,
      encoder: "nvenc",
    }).join(" ");
    expect(preview).toContain(
      `-use_wallclock_as_timestamps 1 -pix_fmt nv12 -video_size 2560x1440 -framerate 30000/1001 -f rawvideo -i tcp://127.0.0.1:${relays.preview}?listen=1&tcp_nodelay=1`
    );
    expect(preview).not.toContain("dshow");
    expect(preview).toContain("[f=flv:onfail=ignore]tcp://127.0.0.1:9");
    expect(preview).toContain("[f=mpjpeg:onfail=ignore]tcp://127.0.0.1:10");
  });

  it("takes the 1440p picture on the GPU for NVENC, and as it comes for libx264", () => {
    const graph = (encoder: "nvenc" | "x264") =>
      graphOf(
        cameraPreviewArgs({ relayPort: 1, port: 2, stillPort: 3, encoder })
      )[0]!;
    expect(graph("nvenc")).toMatch(/^\[0:v\]hwupload_cuda,split\[prev\]\[s\]/);
    expect(graph("x264")).toMatch(/^\[0:v\]split\[prev\]\[s\]/);
    expect(graph("x264")).not.toContain("cuda");
  });

  it("streams each as low-latency H.264 on NVENC: no B-frames, no lookahead, a keyframe a second (#2194)", () => {
    const out = previewOutput(9, 30, "nvenc").join(" ");
    expect(out).toContain(
      "-c:v h264_nvenc -preset p1 -tune ull -zerolatency 1 -delay 0 -rc-lookahead 0 -bf 0"
    );
    expect(out).toContain("-g 30 -forced-idr 1 -no-scenecut 1");
    expect(out).toContain("[f=flv:onfail=ignore]tcp://127.0.0.1:9");
    expect(out).toContain("drop_pkts_on_overflow=1");
    expect(out).not.toContain("libx264");
  });

  it("falls back to #2192's libx264", () => {
    const out = previewOutput(9, 30, "x264").join(" ");
    expect(out).toContain("-c:v libx264 -preset ultrafast -tune zerolatency");
    expect(out).toContain("keyint_min=30:scenecut=0");
    expect(out).not.toContain("nvenc");
    const screen = (encoder: "nvenc" | "x264") =>
      screenPreviewArgs({ screenIndex: 1, port: 9, encoder }).join(" ");
    expect(screen("x264")).toContain(
      `ddagrab=output_idx=1:framerate=60,hwdownload,format=bgra,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,${BT709} -map`
    );
    expect(screen("nvenc")).toContain(
      `ddagrab=output_idx=1:framerate=60,${SCREEN_TO_NV12} -map`
    );
  });
});

describe("a take's camera writer (#2207)", () => {
  it("listens for the writer relay and writes camera.mkv and mic.mkv as the take process always did", () => {
    const args = writer().join(" ");
    expect(args).toContain(
      `-f matroska -i tcp://127.0.0.1:${relays.writer}?listen=1&tcp_nodelay=1`
    );
    expect(args).toContain(
      "-c:v h264_nvenc -preset p5 -tune hq -rc constqp -qp 23 -profile:v high -bf 2 -g 60 -fps_mode passthrough"
    );
    expect(args).toContain(
      "-cluster_time_limit 1000 -flush_packets 1 -f matroska camera.mkv"
    );
    expect(args).toContain("-c:a aac -b:a 192k -ar 48000");
    expect(args).toContain("-f matroska mic.mkv");
    expect(args).not.toMatch(/dshow|libx264/);
  });

  it("drops everything until Record, then keeps both clocks from T0 on: CFR 29.97 and BT.709, the mic from file time 0 with no warm-up trim", () => {
    const [camera, mic, silence] = graphOf(writer());
    expect(camera).toBe(
      "[0:v]setpts@t0=PTS-1e10/TB,select='if(gte(t,0)*gte(prev_selected_t,0)*gt(t-prev_selected_t,0.1),print(-(t-prev_selected_t),24));1',fps=30000/1001:start_time=0,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709[cam]"
    );
    expect(mic).toBe(
      "[0:a]asetpts@t0=PTS-1e10/TB,atrim=start=0,aresample=async=50:min_hard_comp=0.1:first_pts=0,asplit=2[mic][sd]"
    );
    expect(silence).toContain("silencedetect=n=-40dB");
    // Record's T0 reaches both clocks in one command, applied from the
    // first frame stamped T0 or later.
    expect(takeStartCommand(1_760_000_000_123)).toBe(
      "Call 1760000000.123 expr PTS-1760000000.123/TB\n"
    );
  });

  it("looks for Record on its stdin every 50 ms", () => {
    const argv = writer();
    expect(argv[argv.indexOf("-stats_period") + 1]).toBe("0.05");
  });
});

describe("a take's screen recorder", () => {
  it("is ddagrab on the shared clock, as the rig proved", () => {
    const args = screenRecorderArgs({
      t0Ms: 1_000_000,
      tag: "t",
      screenIndex: 1,
    }).join(" ");
    expect(args).toContain("ddagrab=output_idx=1:framerate=60:dup_frames=1");
    expect(args).toMatch(
      /setpts=PTS-1000\.000\/TB,select='[^']*gt\(t-prev_selected_t,0\.05\),print\(-\(t-prev_selected_t\),24\)\);1',fps=60:start_time=0/
    );
    expect(args).toContain("-g 120");
    expect(args).toContain("screen.mkv");
  });

  it("writes OBS's colour on the GPU: BT.709 limited-range NV12 straight to NVENC, tagged so (#1e1e1e is Y=42, as in OBS's files)", () => {
    expect(SCREEN_TO_NV12).toBe(
      "scale_d3d11=format=nv12:out_range=tv:out_color_matrix=bt709," +
        "setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709"
    );
    // No frame comes down from the GPU: no read-back, no CPU pass per frame.
    expect(SCREEN_TO_NV12).not.toMatch(/hwdownload|scale=/);
    const args = screenRecorderArgs({
      t0Ms: 1_000_000,
      tag: "t",
      screenIndex: 1,
    });
    const [screen] = graphOf(args);
    expect(screen?.endsWith(`fps=60:start_time=0,${SCREEN_TO_NV12}[scr]`)).toBe(
      true
    );
    // Tagged once, after scale_d3d11 has made the samples limited.
    expect(screen!.split("setparams").length).toBe(2);
  });

  it("writes nothing to stdout, which nobody reads: a full pipe would leave it deaf to Stop's q", () => {
    const args = screenRecorderArgs({
      t0Ms: 1_000_000,
      tag: "t",
      screenIndex: 0,
    });
    expect(args).not.toContain("-progress");
    expect(args).not.toContain("pipe:1");
  });
});
