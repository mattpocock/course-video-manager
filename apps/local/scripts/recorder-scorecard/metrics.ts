/**
 * THE SCORECARD'S METRICS: each one's target, and OBS's value where the repo
 * has evidence of it. No OBS value is invented: without evidence it is
 * `null` and the report says "unknown". The rule is CVM >= OBS on every
 * metric, so a metric's bar is the stricter of its target and OBS.
 *
 * Evidence (OBS_SOURCES): the obs-free-recorder rig's 30-minute OBS baseline
 * (#1993, rig @5506e214, `/mnt/d/obs-rig/runs/2026-10-11T16-20-09-baseline`),
 * ADR 0042 (OBS's repeated camera frames), PR #2208 / issue #2207 (the CVM
 * numbers before and after long-lived capture).
 */

export type MetricGroup = "speed" | "reliability" | "resources";

export type MetricDef = {
  id: string;
  label: string;
  group: MetricGroup;
  unit: string;
  better: "lower" | "higher";
  target: number;
  /** OBS's value, or null: no evidence. */
  obs: number | null;
  obsSource?: string;
  /** What one "unit of badness" is, to rank gaps of different units together. */
  scale: number;
  note?: string;
};

const RIG = "#1993 rig, OBS 30-min baseline (2026-10-11)";

export const METRICS: readonly MetricDef[] = [
  // SPEED
  {
    id: "record_ack_ms",
    label: "Record press → recorder says recording",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 100,
    obs: null,
    scale: 50,
  },
  {
    id: "record_to_first_camera_frame_ms",
    label: "Record press → first camera frame in camera.mkv",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 100,
    obs: null,
    scale: 33,
  },
  {
    id: "record_to_first_mic_ms",
    label: "Record press → first mic sound in mic.mkv",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 100,
    obs: null,
    scale: 33,
  },
  {
    id: "record_to_first_screen_frame_ms",
    label: "Record press → first screen frame in screen.mkv",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 100,
    obs: null,
    scale: 33,
  },
  {
    id: "stop_to_open_ms",
    label: "Stop press → recorder open again (UI unlocked)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 500,
    obs: null,
    scale: 100,
  },
  {
    id: "stop_to_next_command_ms",
    label: "Stop press → next command answered",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 500,
    obs: null,
    scale: 100,
  },
  {
    id: "stop_to_files_final_ms",
    label: "Stop press → take files finalised (recording-stopped)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 1000,
    obs: null,
    scale: 100,
    note: "OBS: the rig only bounds it (StopRecord → file stable ≤ 8 s, including a 5 s settle wait): not a measurement.",
  },
  {
    id: "preview_camera_idle_p50_ms",
    label: "Camera preview latency, idle (median)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 70,
    obs: null,
    scale: 10,
  },
  {
    id: "preview_camera_take_p50_ms",
    label: "Camera preview latency, during a take (median)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 70,
    obs: null,
    scale: 10,
  },
  {
    id: "preview_camera_take_p95_ms",
    label: "Camera preview latency, during a take (p95)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 100,
    obs: null,
    scale: 10,
  },
  {
    id: "preview_screen_idle_p50_ms",
    label: "Screen preview latency, idle (median)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 70,
    obs: null,
    scale: 10,
  },
  {
    id: "preview_screen_take_p50_ms",
    label: "Screen preview latency, during a take (median)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 70,
    obs: 89,
    obsSource: `${RIG}: OBS Virtual Camera screen path p50 89 ms, recording`,
    scale: 10,
  },
  {
    id: "preview_screen_take_p95_ms",
    label: "Screen preview latency, during a take (p95)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 100,
    obs: 111,
    obsSource: `${RIG}: p95 111 ms`,
    scale: 10,
  },
  {
    id: "preview_gap_on_record_ms",
    label: "Longest camera preview gap around Record",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 100,
    obs: null,
    scale: 33,
    note: "OBS: prose only (its preview never reopens).",
  },
  {
    id: "preview_gap_on_stop_ms",
    label: "Longest camera preview gap around Stop",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 100,
    obs: null,
    scale: 33,
  },
  {
    id: "screen_preview_gap_on_record_ms",
    label: "Longest screen preview gap around Record",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 100,
    obs: null,
    scale: 33,
  },
  {
    id: "optimistic_clip_delay_ms",
    label: "Optimistic Clip delay (Take rule met → take-started heard)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 250,
    obs: null,
    scale: 50,
  },
  {
    id: "clip_end_delay_ms",
    label: "Clip end delay (silence long enough → speech-ended heard)",
    group: "speed",
    unit: "ms",
    better: "lower",
    target: 250,
    obs: null,
    scale: 50,
  },
  // RESOURCES
  {
    id: "cpu_idle_pct",
    label: "Recorder CPU, open and idle (% of machine)",
    group: "resources",
    unit: "%",
    better: "lower",
    target: 2,
    obs: null,
    scale: 0.5,
    note: "Includes generating the synthetic sources (lavfi, geq) inside the capture processes.",
  },
  {
    id: "cpu_recording_pct",
    label: "Recorder CPU, recording (% of machine)",
    group: "resources",
    unit: "%",
    better: "lower",
    target: 2,
    obs: 0.31,
    obsSource: `${RIG}: OBS process avg 0.31% of 32 logical CPUs (CPU was waived by Matt in #1993)`,
    scale: 0.5,
    note: "Includes generating the synthetic sources. Matt waived CPU in #1993.",
  },
  {
    id: "memory_recording_mb",
    label: "Recorder memory, recording (ffmpeg.exe working sets + service RSS)",
    group: "resources",
    unit: "MB",
    better: "lower",
    target: 1500,
    obs: null,
    scale: 100,
  },
  {
    id: "gpu_recording_delta_pct",
    label: "GPU utilisation added by recording (vs before the service)",
    group: "resources",
    unit: "pp",
    better: "lower",
    target: 50,
    obs: null,
    scale: 5,
    note: "Whole-GPU reading less the reading before the service started; anything else on the GPU moves it.",
  },
  {
    id: "nvenc_recording_delta_pct",
    label: "NVENC utilisation added by recording",
    group: "resources",
    unit: "pp",
    better: "lower",
    target: 45,
    obs: 42.7,
    obsSource: `${RIG}: OBS NVENC avg 42.7% (whole GPU)`,
    scale: 5,
    note: "OBS's figure is the whole GPU while OBS recorded the real rig.",
  },
  {
    id: "vram_recording_delta_mb",
    label: "GPU memory added by recording",
    group: "resources",
    unit: "MB",
    better: "lower",
    target: 1700,
    obs: null,
    scale: 100,
    note: "OBS's rig run used 1662 MiB of VRAM on the whole GPU (not a delta), so it is not a reference here.",
  },
  // RELIABILITY
  {
    id: "camera_dropped_frames",
    label: "Camera frames dropped in the long take",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
    note: "Read from each frame's burned-in index, never its clock: a starved synthetic source stamps late frames back to back (`sourceStalls` in the details).",
  },
  {
    id: "camera_repeated_per_100",
    label: "Camera frames repeated per 100 (long take)",
    group: "reliability",
    unit: "/100",
    better: "lower",
    target: 0.1,
    obs: 0.1,
    obsSource:
      "ADR 0042: OBS repeats about 0.1 per 100 at 1080p59.94 (real Cam Link)",
    scale: 0.1,
    note: "The synthetic camera never repeats a frame itself; the real Cam Link at 4K does (ADR 0042, ~11 per 100).",
  },
  {
    id: "screen_dropped_frames",
    label: "Screen frames dropped in the long take",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
    note: "Read from each frame's burned-in index, never its clock: a starved synthetic source stamps late frames back to back (`sourceStalls` in the details).",
  },
  {
    id: "screen_repeated_per_100",
    label: "Screen frames repeated per 100 (long take)",
    group: "reliability",
    unit: "/100",
    better: "lower",
    target: 0.1,
    obs: null,
    scale: 0.1,
  },
  {
    id: "service_frames_lost",
    label: "Frames the service itself reports lost (long take)",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
  },
  {
    id: "service_screen_frames_lost",
    label: "Screen frames the service itself reports lost (long take)",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
  },
  {
    id: "av_drift_ms",
    label: "A/V drift (mic vs camera) across the long take",
    group: "reliability",
    unit: "ms",
    better: "lower",
    target: 10,
    obs: 0.3,
    obsSource: `${RIG}: OBS audio − camera trend 0.3 ms over 30 min`,
    scale: 5,
    note: "Absolute change from the first minute to the last.",
  },
  {
    id: "screen_lag_drift_ms",
    label: "Screen lag drift across the long take",
    group: "reliability",
    unit: "ms",
    better: "lower",
    target: 10,
    obs: null,
    scale: 5,
  },
  {
    id: "crash_files_playable",
    label: "Service killed mid-take: files playable",
    group: "reliability",
    unit: "of 3",
    better: "higher",
    target: 3,
    obs: null,
    scale: 1,
  },
  {
    id: "crash_take_recovered",
    label: "Service killed mid-take: take recovered on restart",
    group: "reliability",
    unit: "bool",
    better: "higher",
    target: 1,
    obs: null,
    scale: 1,
  },
  {
    id: "crash_seconds_lost",
    label: "Service killed mid-take: seconds of camera lost",
    group: "reliability",
    unit: "s",
    better: "lower",
    target: 1,
    obs: null,
    scale: 0.5,
  },
  {
    id: "crash_recovery_ms",
    label: "Service killed mid-take: restart → recovered",
    group: "reliability",
    unit: "ms",
    better: "lower",
    target: 15000,
    obs: null,
    scale: 1000,
  },
  {
    id: "preview_kill_pass_rate_pct",
    label: "Preview killed → recording unaffected: pass rate over the runs",
    group: "reliability",
    unit: "%",
    better: "higher",
    target: 100,
    obs: null,
    scale: 10,
    note: "A run passes when the take stops cleanly on request with no frame of camera.mkv lost.",
  },
  {
    id: "stop_capture_survival_pct",
    label:
      "Writer reconnect at Stop: capture lives through it (pass rate over the cycles)",
    group: "reliability",
    unit: "%",
    better: "higher",
    target: 100,
    obs: null,
    scale: 10,
  },
  {
    id: "capture_restarts_per_stop",
    label: "Camera capture process restarts per Stop",
    group: "reliability",
    unit: "/stop",
    better: "lower",
    target: 0,
    obs: null,
    scale: 0.02,
  },
  {
    id: "preview_kill_take_frames_lost",
    label: "Preview killed mid-take: camera.mkv frames lost (worst run)",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
  },
  {
    id: "preview_kill_take_ok",
    label: "Preview killed mid-take: every run carries on and stops cleanly",
    group: "reliability",
    unit: "bool",
    better: "higher",
    target: 1,
    obs: null,
    scale: 1,
  },
  {
    id: "preview_kill_recovery_ms",
    label: "Preview killed: kill → preview frames again (median run)",
    group: "reliability",
    unit: "ms",
    better: "lower",
    target: 3000,
    obs: null,
    scale: 500,
  },
  {
    id: "cycles_failed",
    label: "Back-to-back Record/Stop cycles that failed",
    group: "reliability",
    unit: "cycles",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
  },
  {
    id: "cycles_leaked_processes",
    label: "ffmpeg.exe processes left over after the cycles",
    group: "reliability",
    unit: "procs",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
  },
  {
    id: "cycles_memory_growth_mb",
    label: "Memory growth across the cycles",
    group: "reliability",
    unit: "MB",
    better: "lower",
    target: 20,
    obs: null,
    scale: 10,
  },
  {
    id: "cycles_record_ack_p90_ms",
    label: "Cycles: Record press → recording (p90)",
    group: "reliability",
    unit: "ms",
    better: "lower",
    target: 150,
    obs: null,
    scale: 50,
  },
  {
    id: "cycles_stop_final_p90_ms",
    label: "Cycles: Stop press → files finalised (p90)",
    group: "reliability",
    unit: "ms",
    better: "lower",
    target: 1000,
    obs: null,
    scale: 100,
  },
  {
    id: "event_log_failure_stops_cleanly",
    label: "Event log write fails mid-take: take stops with playable files",
    group: "reliability",
    unit: "bool",
    better: "higher",
    target: 1,
    obs: null,
    scale: 1,
  },
  // THE STREAMED RECORDING SESSION (#2455): raw footage first, then the
  // Live Stream's picture against a local sink. #2461 adds the Chat
  // Highlight's click-to-on-screen time and monotonic card opacity here.
  {
    id: "streamed_camera_frames_lost",
    label:
      "Camera frames the service reports lost in a streamed Recording Session",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
  },
  {
    id: "streamed_screen_frames_lost",
    label:
      "Screen frames the service reports lost in a streamed Recording Session",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
  },
  {
    id: "stream_fps_off_60",
    label: "Live Stream frame rate's distance from 60.0 fps",
    group: "reliability",
    unit: "fps",
    better: "lower",
    target: 0.05,
    obs: null,
    scale: 0.05,
    note: "Frames the stream's encoder put out per second of wall time (its -progress, least-squares, from 5 s after it went live until its process is killed mid-take). The rate itself is `streamed.streamFps` in the details.",
  },
  {
    id: "stream_dup_frames",
    label: "Live Stream frames duplicated (its first process's whole run)",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
  },
  {
    id: "stream_drop_frames",
    label: "Live Stream frames dropped (its first process's whole run)",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
  },
  // #2459: it reconnects for ever, and the take never notices (the
  // streamed framesLost above cover the take).
  {
    id: "stream_back_after_sink_drop",
    label:
      "Sink dropped and back mid-take: the Live Stream reconnects inside its process",
    group: "reliability",
    unit: "bool",
    better: "higher",
    target: 1,
    obs: null,
    scale: 1,
    note: "Reconnecting heard, live again once the sink listens again, no relaunch, and the new sink got frames. Details: `streamed.faults.sinkDrop`.",
  },
  {
    id: "stream_back_after_kill",
    label:
      "Stream process killed mid-take: launched again, and live onto a new sink",
    group: "reliability",
    unit: "bool",
    better: "higher",
    target: 1,
    obs: null,
    scale: 1,
    note: "Details: `streamed.faults.kill`.",
  },
  {
    id: "stream_relaunched_fps_off_60",
    label:
      "Relaunched Live Stream frame rate's distance from 60.0 fps (its picture starts where the feeds are, so it never races to catch up)",
    group: "reliability",
    unit: "fps",
    better: "lower",
    target: 0.05,
    obs: null,
    scale: 0.05,
    note: "As `stream_fps_off_60`, from 5 s after the relaunched process went live to End Stream. Details: `streamed.faults.relaunchedPicture`.",
  },
  {
    id: "disk_full",
    label: "Disk full mid-take",
    group: "reliability",
    unit: "bool",
    better: "higher",
    target: 1,
    obs: null,
    scale: 1,
    note: "Not simulated: a size-limited or throttled filesystem needs root, and the footage drive must never be filled.",
  },
];

export type Measured = Record<string, number | null>;

export type Row = MetricDef & {
  value: number | null;
  /** The stricter of the target and OBS. */
  bar: number;
  status: "pass" | "fail" | "unmeasured";
  /** How far past the bar, in `scale`s; 0 when passing. */
  gap: number;
  vsObs: "better-or-equal" | "worse" | "unknown";
};

export const score = (def: MetricDef, value: number | null): Row => {
  const lower = def.better === "lower";
  const bar =
    def.obs === null
      ? def.target
      : lower
        ? Math.min(def.target, def.obs)
        : Math.max(def.target, def.obs);
  if (value === null || !Number.isFinite(value))
    return {
      ...def,
      value: null,
      bar,
      status: "unmeasured",
      gap: 0,
      vsObs: "unknown",
    };
  const excess = lower ? value - bar : bar - value;
  const vsObs =
    def.obs === null
      ? "unknown"
      : (lower ? value <= def.obs : value >= def.obs)
        ? "better-or-equal"
        : "worse";
  return {
    ...def,
    value,
    bar,
    status: excess > 0 ? "fail" : "pass",
    gap: excess > 0 ? excess / def.scale : 0,
    vsObs,
  };
};

/** Every metric scored; failing ones first, widest gap first; then unmeasured; then passing. */
export const rank = (measured: Measured): Row[] => {
  const order = { fail: 0, unmeasured: 1, pass: 2 } as const;
  return METRICS.map((def) => score(def, measured[def.id] ?? null)).sort(
    (a, b) => order[a.status] - order[b.status] || b.gap - a.gap
  );
};
