// 1 Hz resource sampling, written raw so the analysis can re-parse it:
//  perf-cpu.csv  typeperf: total CPU plus every ffmpeg / obs64 / chrome process
//  perf-gpu.csv  nvidia-smi: GPU 3D, NVENC and NVDEC use, VRAM, power
//  disk.jsonl    size of the files being recorded, every 10 s
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM32 } from "./win.ts";

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
      clearInterval(disk);
      for (const p of procs) p.kill();
    },
  };
}
