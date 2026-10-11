// `./rig check`, the cases from Matt's first real run (2026-10-11, wizard
// session 2026-10-11_16-50, CVM #1992). Each one failed on the analysis that
// scored that run and passes now. The phone-marker ones (the page's flash vs
// its beep, the phone's flash jitter) are in phone-checks.ts, which owns the
// synthetic phone run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { headerHasTotal } from "./collector.ts";
import {
  arrivalsFromPts,
  judderNote,
  lipSyncVsObs,
  passed,
  resourceVerdict,
} from "./judge.ts";
import { obsMicSyncOffset } from "./obs-sync.ts";
import { totalCpu } from "./perf.ts";
import { runVerdict } from "./rescore.ts";

type Case = { name: string; ok: () => boolean | string };

// The selftest's kill -9 phase: meta.json only (rig.ts never analyses it).
const CRASH_META = (pass: boolean) =>
  JSON.stringify({
    mode: "crash",
    crash: {
      killedAtFileTime: 44.508,
      pass,
      files: [
        { file: "screen.mkv", ok: true, lostSeconds: 0.46 },
        { file: "camera.mkv", ok: pass, lostSeconds: pass ? 0.46 : 7.1 },
        { file: "mic.mkv", ok: true, lostSeconds: 0.35 },
      ],
    },
  });

// Matt's scene collection (Untitled.json), cut down: the mic "Shure MV7" with
// its +150 ms sync offset in the Code scene, the Cam Link muted, a second Cam
// Link (unmuted, 0 ms) in a TikTok scene only, and the global devices.
const MATT_SCENES = {
  DesktopAudioDevice1: {
    name: "Desktop Audio",
    id: "wasapi_output_capture",
    sync: 0,
    muted: false,
    mixers: 255,
  },
  AuxAudioDevice1: {
    name: "Mic/Aux",
    id: "wasapi_input_capture",
    sync: 0,
    muted: true,
    mixers: 255,
  },
  sources: [
    { name: "Display Capture", id: "monitor_capture", sync: 0, mixers: 0 },
    {
      name: "Shure MV7",
      id: "wasapi_input_capture",
      sync: 150_000_000,
      muted: false,
      mixers: 255,
    },
    { name: "CamLink", id: "dshow_input", sync: 0, muted: true, mixers: 255 },
    {
      name: "CamLink For TikTok",
      id: "dshow_input",
      sync: 0,
      muted: false,
      mixers: 255,
    },
    {
      name: "Code",
      id: "scene",
      settings: {
        items: [
          { name: "Shure MV7", visible: true },
          { name: "Display Capture", visible: true },
          { name: "CamLink", visible: true },
        ],
      },
    },
    {
      name: "TikTok Face",
      id: "scene",
      settings: { items: [{ name: "CamLink For TikTok", visible: true }] },
    },
  ],
};

/** A run folder holding just these files, in the OS temp dir. */
function tmpRun(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-check-"));
  for (const [f, body] of Object.entries(files))
    fs.writeFileSync(path.join(dir, f), body);
  return dir;
}

// The baseline's perf-cpu.csv header: typeperf left \Processor(_Total) out.
const NO_TOTAL =
  '\r\n"(PDH-CSV 4.0)","\\\\MATT-PC\\Process(obs64)\\% Processor Time","\\\\MATT-PC\\Process(chrome#27)\\% Processor Time"\r\n' +
  '"10/11/2026 16:20:13.084","10.2","0.0"\r\n"10/11/2026 16:20:14.084","11.0","1.5"\r\n';
// The collector's own total file, where typeperf kept only the fallback counter.
const INFO_TOTAL =
  '\r\n"(PDH-CSV 4.0)","\\\\MATT-PC\\Processor Information(_Total)\\% Processor Time"\r\n' +
  '"10/11/2026 16:20:13.084","6.5"\r\n"10/11/2026 16:20:14.084","7.5"\r\n';

export const runCases: Case[] = [
  {
    name: "run 2026-10-11: the selftest's kill -9 run (meta.json only, crash.pass true) PASSes; crash.pass false and an empty folder FAIL",
    ok: () => {
      const pass = runVerdict(null, CRASH_META(true));
      const fail = runVerdict(null, CRASH_META(false));
      const none = runVerdict(null, null);
      const report = runVerdict(
        "# r\n\n## Stop criteria\n\n| Criterion | Result |\n|---|---|\n| A/V drift <= 33 ms | PASS |\n| no dropped frames | FAIL (camera 1 lost) |\n\n## Frames\n",
        null
      );
      const ok =
        pass.pass &&
        /\| kill -9 recovery \(<= 2 s lost\) \| PASS/.test(pass.table) &&
        !fail.pass &&
        /\| FAIL/.test(fail.table) &&
        !none.pass &&
        !report.pass &&
        report.table.split("\n").filter((l) => l.startsWith("| ")).length === 3;
      return ok || JSON.stringify({ pass, fail, none, report });
    },
  },
  {
    name: "run 2026-10-11: OBS's +150 ms mic sync offset is read from the scene collection and taken off lip sync vs OBS (-138.3 raw → +11.7 PASS)",
    ok: () => {
      const o = obsMicSyncOffset(MATT_SCENES);
      // The run's medians: rig 41.0 ms, OBS 179.3 ms (audio - camera).
      const v = lipSyncVsObs(41, 179.3, o.audioOffsetMs);
      const raw = lipSyncVsObs(41, 179.3);
      const ok =
        o.audioOffsetMs === 150 &&
        /Shure MV7/.test(o.detail) &&
        v.deltaMs === 11.7 &&
        v.rawDeltaMs === -138.3 &&
        passed(v.verdict) &&
        /150 ms mic sync offset/.test(v.verdict) &&
        !passed(raw.verdict);
      return ok || JSON.stringify({ o, v, raw });
    },
  },
  {
    name: "OBS sync offset: two audible mics that disagree is unknown, not a guess; unknown says '0 assumed'",
    ok: () => {
      const two = structuredClone(MATT_SCENES);
      two.AuxAudioDevice1.muted = false;
      const o = obsMicSyncOffset(two);
      const v = lipSyncVsObs(41, 179.3, o.audioOffsetMs);
      return (
        (o.audioOffsetMs === null && /0 assumed/.test(v.verdict)) ||
        JSON.stringify({ o, v })
      );
    },
  },
  {
    name: "run 2026-10-11: total CPU missing from the baseline is FAIL 'not measured', never 0x/PASS",
    ok: () => {
      const v = resourceVerdict(
        { cpuTotal: null, gpu: 0.58 },
        { cpu: "baseline: perf-cpu.csv has no _Total column" }
      );
      const good = resourceVerdict({ cpuTotal: 1.2, gpu: 0.58 });
      const high = resourceVerdict({ cpuTotal: 1.7, gpu: 0.58 });
      const ok =
        !passed(v) &&
        /total CPU not measured/.test(v) &&
        /_Total/.test(v) &&
        passed(good) &&
        !passed(high);
      return ok || JSON.stringify({ v, good, high });
    },
  },
  {
    name: "CPU: a run whose typeperf dropped _Total says why; the collector's own file with Processor Information(_Total) is read instead",
    ok: () => {
      const missing = totalCpu(tmpRun({ "perf-cpu.csv": NO_TOTAL }));
      const rescued = totalCpu(
        tmpRun({ "perf-cpu.csv": NO_TOTAL, "perf-cpu-total.csv": INFO_TOTAL })
      );
      const header = (s: string) =>
        s.split("\n").find((l) => l.startsWith('"(PDH'))!;
      const ok =
        missing.samples.length === 0 &&
        /no _Total column/.test(missing.missing ?? "") &&
        rescued.samples.join() === "6.5,7.5" &&
        !headerHasTotal(header(NO_TOTAL)) &&
        headerHasTotal(header(INFO_TOTAL));
      return ok || JSON.stringify({ missing, rescued });
    },
  },
  {
    name: "screen judder: one frame a second stamped 0.6 frame late reads as ~60 repeat+drop pairs a minute (1.7%); a steady screen reads 0",
    ok: () => {
      const late = Array.from({ length: 60 * 120 }, (_, i) =>
        i % 60 === 30 ? (i + 0.6) / 60 : i / 60
      );
      const steady = Array.from({ length: 60 * 120 }, (_, i) => i / 60);
      const a = arrivalsFromPts(late, 60, { rateLocked: true })!;
      const s = arrivalsFromPts(steady, 60, { rateLocked: true })!;
      const ok =
        Math.abs(a.judder.perMin - 60) <= 2 &&
        Math.abs(a.judder.pct - 1.67) <= 0.05 &&
        s.judder.pct === 0 &&
        /1\.67% of output frames/.test(judderNote(a));
      return ok || JSON.stringify({ late: a.judder, steady: s.judder });
    },
  },
];
