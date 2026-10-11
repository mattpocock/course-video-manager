// 1 Hz resource sampling, written raw so the analysis can re-parse it:
//  perf-cpu.csv  typeperf: total CPU plus every ffmpeg / obs64 / chrome process
//  perf-cpu-total.csv  typeperf: total CPU on its own (see startTotalCpu)
//  perf-gpu.csv  nvidia-smi: GPU 3D, NVENC and NVDEC use, VRAM, power
//  disk.jsonl    size of the files being recorded, every 10 s
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM32 } from "./win.ts";
import { CPU_TOTAL_FILE, TOTAL_CPU_COLUMN } from "./perf.ts";

const TOTAL_COUNTERS = [
  "\\Processor(_Total)\\% Processor Time",
  "\\Processor Information(_Total)\\% Processor Time",
];

/** Does a typeperf header line hold a total CPU column? */
export const headerHasTotal = (header: string) =>
  [...header.matchAll(/"([^"]*)"/g)].some((m) => TOTAL_CPU_COLUMN.test(m[1]!));

/**
 * Total CPU in a typeperf of its own. typeperf drops a counter for the whole
 * run, silently, when its first sample fails, and on the rig PC it dropped
 * \Processor(_Total) in 7 of 22 runs (reproduced by hand: 5 of 14 starts).
 * Two total counters are asked for, and typeperf is restarted, up to 5 times,
 * until its header has one of them; the file is written only from that start.
 */
function startTotalCpu(runDir: string, procs: ChildProcess[]) {
  const out = fs.createWriteStream(path.join(runDir, CPU_TOTAL_FILE));
  let tries = 0;
  let stopped = false;
  const start = () => {
    tries++;
    const child = spawn(
      `${SYSTEM32}/typeperf.exe`,
      [...TOTAL_COUNTERS, "-si", "1"],
      { cwd: "/mnt/c" }
    );
    procs.push(child);
    process.once("exit", () => child.exitCode === null && child.kill());
    child.stderr.on("data", () => {});
    let head = "";
    let piping = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (piping) return void out.write(chunk);
      head += String(chunk);
      const line = head.split(/\r?\n/).find((l) => l.startsWith('"(PDH-CSV'));
      if (!line) return;
      if (headerHasTotal(line) || tries >= 5) {
        piping = true;
        out.write(head);
      } else {
        child.kill();
        if (!stopped) setTimeout(start, 500);
      }
    });
  };
  start();
  return () => {
    stopped = true;
  };
}

export function startCollector(runDir: string, watchFiles: () => string[]) {
  const procs: ChildProcess[] = [];
  const pipeTo = (file: string, child: ChildProcess) => {
    const out = fs.createWriteStream(path.join(runDir, file));
    child.stdout!.pipe(out);
    child.stderr!.on("data", () => {});
    procs.push(child);
    process.once("exit", () => child.exitCode === null && child.kill());
  };
  pipeTo(
    "perf-cpu.csv",
    spawn(
      `${SYSTEM32}/typeperf.exe`,
      [
        "\\Processor(_Total)\\% Processor Time",
        // Partial wildcards expand when typeperf starts, so start it after the recorders.
        "\\Process(ffmpeg*)\\% Processor Time",
        "\\Process(obs64*)\\% Processor Time",
        "\\Process(chrome*)\\% Processor Time",
        "-si",
        "1",
      ],
      { cwd: "/mnt/c" }
    )
  );
  pipeTo(
    "perf-gpu.csv",
    spawn(
      `${SYSTEM32}/nvidia-smi.exe`,
      [
        "--query-gpu=timestamp,utilization.gpu,utilization.encoder,utilization.decoder,memory.used,power.draw",
        "--format=csv,nounits",
        "-lms",
        "1000",
      ],
      { cwd: "/mnt/c" }
    )
  );
  const stopTotal = startTotalCpu(runDir, procs);
  const disk = setInterval(() => {
    const sizes = Object.fromEntries(
      watchFiles().map((f) => [
        path.basename(f),
        fs.existsSync(f) ? fs.statSync(f).size : 0,
      ])
    );
    fs.appendFileSync(
      path.join(runDir, "disk.jsonl"),
      JSON.stringify({ at: Date.now(), sizes }) + "\n"
    );
  }, 10_000);
  return {
    stop: () => {
      stopTotal();
      clearInterval(disk);
      for (const p of procs) p.kill();
    },
  };
}
