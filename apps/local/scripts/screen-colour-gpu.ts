import { execFileSync } from "node:child_process";
import { BT709, SCREEN_TO_NV12 } from "../recorder-service/colour";
import { nvenc } from "../recorder-service/capture-args";
import { SCREEN_FRAME_GAP_SECONDS } from "../recorder-service/take-args";
import { findFfmpegExe } from "../recorder-service/windows-launcher";
import { guardWindows } from "./windows-guard";

/**
 * The screen's colour and cost on the real GPU, with synthetic frames only
 * (no screen capture): lavfi RGB, uploaded to D3D11 as ddagrab's frame would
 * be, then the screen recorder's chain. Compares CVM's GPU chain
 * (`SCREEN_TO_NV12`) with #2225's (GPU to full range, read back, CPU squeeze
 * to limited), which Matt signed off ("the color is perfect").
 *
 *   pnpm --filter @cvm/local exec tsx scripts/screen-colour-gpu.ts [--exe <wsl path>] [--frames N]
 *
 * Every ffmpeg.exe starts through the Windows guard (Idle, cores 6-9), so
 * it refuses while the recorder or OBS runs. Nothing is written to disk.
 */

/** #2225's chain, as merged (a25ed4f0): the reference. */
const PR_2225 = [
  "scale_d3d11=format=nv12",
  "hwdownload",
  "format=nv12",
  "scale=in_range=pc:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709",
  "format=nv12",
  BT709,
].join(",");

/** Ten greys and colours: black, #101010, VS Code's #1e1e1e, mid grey, VS Code's text, white, and four syntax colours. */
const COLOURS = [
  "000000",
  "101010",
  "1e1e1e",
  "808080",
  "d4d4d4",
  "ffffff",
  "3178c6",
  "ce9178",
  "569cd6",
  "6a9955",
];
const PATCH = 64;
const W = PATCH * COLOURS.length;
const H = PATCH;
const STRIP =
  COLOURS.map(
    (c, i) => `color=c=0x${c}:s=${PATCH}x${PATCH}:r=60:d=0.1[c${i}]`
  ).join(";") +
  `;${COLOURS.map((_, i) => `[c${i}]`).join("")}hstack=${COLOURS.length},format=bgra`;

const D3D11 = ["-init_hw_device", "d3d11va=d", "-filter_hw_device", "d"];

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const exe = opt("--exe") ?? findFfmpegExe();
if (!exe) throw new Error("no ffmpeg.exe: pass --exe or install CVM's build");
const FRAMES = Number(opt("--frames") ?? 600);
const windows = guardWindows();

const run = (args: string[]) =>
  new Promise<{ stdout: Buffer; stderr: string; code: number | null }>(
    (resolve) => {
      const child = windows.spawn(exe, [
        "-hide_banner",
        "-nostdin",
        "-nostats",
        ...args,
      ]);
      const out: Buffer[] = [];
      let err = "";
      child.stdout!.on("data", (d: Buffer) => out.push(d));
      child.stderr!.on("data", (d: Buffer) => (err += d.toString()));
      child.on("close", (code) =>
        resolve({ stdout: Buffer.concat(out), stderr: err, code })
      );
    }
  );

/** One frame of the strip through `chain`, as raw NV12 from system memory. */
const strip = async (chain: string) => {
  const r = await run([
    ...D3D11,
    "-f",
    "lavfi",
    "-i",
    STRIP,
    "-vf",
    `hwupload,${chain}${chain.includes("hwdownload") ? "" : ",hwdownload,format=nv12"}`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  if (r.code !== 0 || r.stdout.length !== W * H * 1.5)
    throw new Error(`strip failed (${r.code}): ${r.stderr.slice(-800)}`);
  return r.stdout;
};

/** Y, U, V at the centre of patch i, and the RGB a BT.709 limited decode shows. */
const sample = (nv12: Buffer, i: number) => {
  const x = i * PATCH + PATCH / 2;
  const y = PATCH / 2;
  const Y = nv12[y * W + x]!;
  const uv = W * H + (y / 2) * W + (x & ~1);
  const U = nv12[uv]!;
  const V = nv12[uv + 1]!;
  const yy = (Y - 16) / 219;
  const cb = (U - 128) / 224;
  const cr = (V - 128) / 224;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const rgb = [
    c(yy + 1.5748 * cr),
    c(yy - 0.1873 * cb - 0.4681 * cr),
    c(yy + 1.8556 * cb),
  ];
  return { Y, U, V, rgb };
};

const hex = (rgb: number[]) =>
  rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

/** CPU and speed of the screen recorder's chain, BGRA upload to NVENC. */
const bench = async (size: string, chain: string, paced: boolean) => {
  const r = await run([
    "-benchmark",
    ...D3D11,
    ...(paced ? ["-re"] : []),
    "-f",
    "lavfi",
    "-i",
    `color=c=0x1e1e1e:s=${size}:r=60,format=bgra`,
    "-vf",
    `hwupload,${chain}`,
    "-frames:v",
    String(FRAMES),
    ...nvenc(120),
    "-f",
    "null",
    "-",
  ]);
  const m = /bench: utime=([\d.]+)s stime=([\d.]+)s rtime=([\d.]+)s/.exec(
    r.stderr
  );
  if (r.code !== 0 || !m)
    throw new Error(`bench failed (${r.code}): ${r.stderr.slice(-800)}`);
  const [u, s, rt] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return {
    cpuMsPerFrame: ((u + s) * 1000) / FRAMES,
    cores: (u + s) / rt,
    fps: FRAMES / rt,
  };
};

/**
 * Stalls at start-up (PR #2228: since #2225 every session's screen log shows
 * ~50-57 frames of gaps in its first second). ddagrab stamps each frame when
 * it grabs it and misses the slots while the graph stalls. Here a paced
 * source is stamped with the wall clock as the graph takes each frame, so a
 * stall in the chain (or its first-frame set-up) shows as a gap, logged by
 * the screen recorder's own rule (> SCREEN_FRAME_GAP_SECONDS).
 */
const startup = async (size: string, chain: string) => {
  const seconds = 5;
  const r = await run([
    ...D3D11,
    "-re",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x1e1e1e:s=${size}:r=60,format=bgra`,
    "-vf",
    `settb=AVTB,setpts='(RTCTIME-RTCSTART)/(TB*1000000)',` +
      `select='if(gte(prev_selected_t,0)*gt(t-prev_selected_t,${SCREEN_FRAME_GAP_SECONDS}),print(-(t-prev_selected_t),24));1',fps=60:start_time=0,` +
      `hwupload,${chain}`,
    "-frames:v",
    String(seconds * 60),
    ...nvenc(120),
    "-f",
    "null",
    "-",
  ]);
  if (r.code !== 0)
    throw new Error(`startup failed (${r.code}): ${r.stderr.slice(-800)}`);
  const gaps = [...r.stderr.matchAll(/^-(\d+\.\d+)\r?$/gm)].map((m) =>
    Number(m[1])
  );
  const missing = gaps.reduce((n, g) => n + Math.round(g * 60) - 1, 0);
  return { gaps: gaps.length, missing };
};

const main = async () => {
  const version = /ffmpeg version (\S+)/.exec(
    (await run(["-version"])).stdout.toString()
  )?.[1];
  console.log(`ffmpeg.exe ${version} (${exe})`);
  const gpus = execFileSync("nvidia-smi", [
    "--query-gpu=name,driver_version",
    "--format=csv,noheader",
  ])
    .toString()
    .trim();
  console.log(`GPU: ${gpus}\n`);

  console.log("== Colour: one frame of ten patches, BGRA uploaded to D3D11");
  const ref = await strip(PR_2225);
  const gpu = await strip(SCREEN_TO_NV12);
  let diff = 0;
  let maxDelta = 0;
  for (let i = 0; i < ref.length; i++) {
    const d = Math.abs(ref[i]! - gpu[i]!);
    if (d) diff++;
    maxDelta = Math.max(maxDelta, d);
  }
  console.log(
    `bytes differing: ${diff} of ${ref.length} (max delta ${maxDelta})${diff === 0 ? ": BYTE-IDENTICAL" : ""}`
  );
  console.log("colour   | #2225 Y/U/V -> RGB      | GPU Y/U/V -> RGB");
  COLOURS.forEach((c, i) => {
    const a = sample(ref, i);
    const b = sample(gpu, i);
    console.log(
      `#${c}  | ${[a.Y, a.U, a.V].join("/").padEnd(11)} -> #${hex(a.rgb)} | ${[b.Y, b.U, b.V].join("/").padEnd(11)} -> #${hex(b.rgb)}`
    );
  });

  for (const size of ["2560x1440", "3840x2160"]) {
    console.log(
      `\n== ${size}: start-up gaps, first 5 s paced at 60 fps (3 runs)`
    );
    for (const [name, chain] of [
      ["#2225", PR_2225],
      ["GPU  ", SCREEN_TO_NV12],
    ] as const) {
      const runs = [];
      for (let k = 0; k < 3; k++) runs.push(await startup(size, chain));
      console.log(
        `${name}: ${runs.map((x) => `${x.gaps} gaps / ${x.missing} frames missed`).join(", ")}`
      );
    }
    for (const paced of [false, true]) {
      console.log(
        `\n== ${size}, ${FRAMES} frames, ${paced ? "paced at 60 fps (-re)" : "as fast as it goes"}`
      );
      for (const [name, chain] of [
        ["#2225", PR_2225],
        ["GPU  ", SCREEN_TO_NV12],
      ] as const) {
        const b = await bench(size, chain, paced);
        console.log(
          `${name}: ${b.fps.toFixed(1)} fps, ${b.cpuMsPerFrame.toFixed(2)} ms CPU/frame, ${(b.cores * 100).toFixed(0)}% of a core`
        );
      }
    }
  }
};

await main();
