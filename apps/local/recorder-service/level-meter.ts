import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CALIBRATION_CAMERA_FILE,
  CALIBRATION_CAPTURE_LOG,
  CALIBRATION_MIC_FILE,
  measureCalibration,
} from "./calibration-run";
import { CAM_LINK_NOT_STARTING, quitProcess, saysDeviceBusy } from "./camera";
import { calibrationCaptureArgs, METER_TAG, micInput } from "./capture-args";
import { lineSplitter, type Launcher } from "./launcher";
import type {
  CalibrationWindow,
  MeterReading,
  RecorderMessage,
} from "./protocol";
import { findByName, Refusal } from "./refusal";
import { listDshowDevices } from "./windows-devices";
import { MIC_NAME } from "../app/mic-device";
import {
  CAM_LINK_IN_USE_TO_CALIBRATE,
  runMeasurementWindows,
} from "../app/av-calibration-constants";
import {
  motionLineReader,
  type MotionPoint,
} from "../app/packages/clap-detection/live";
import { createLiveClaps, type LiveClaps } from "./live-claps";

/**
 * THE LEVEL METER (#2078): the AV Calibration page's live loudness of the
 * mic. A mic-only ffmpeg.exe on the mic the CVM recorder records, opened as
 * the recording opens it (`micInput`: raw, pre-EQ), through ffmpeg's ebur128,
 * which logs momentary (400 ms) and short-term (3 s) loudness every 100 ms.
 * It needs no Video and no camera, and it changes no device and no level: it
 * only listens.
 */

/** ffmpeg.exe's args for the plain meter on `mic` (its DirectShow name): it writes nothing. */
export const levelMeterArgs = (mic: string) => [
  "-hide_banner",
  "-nostats",
  "-loglevel",
  "level+info",
  ...micInput(mic),
  "-af",
  // framelog=info: ebur128 logs each 100 ms reading at info, not verbose.
  "ebur128=framelog=info",
  "-metadata",
  `comment=${METER_TAG}`,
  "-f",
  "null",
  "-",
];

const NUMBER = String.raw`(-?(?:[\d.]+|inf)|nan)`;
const READING = new RegExp(
  String.raw`\bt:\s*([\d.]+)\s+TARGET:.*?\bM:\s*${NUMBER}\s+S:\s*${NUMBER}`
);

/** ebur128 says -inf, nan or -120.7 before it has heard anything. */
const loudness = (s: string) => {
  const n = Number(s.replace(/^-inf$/, "-Infinity"));
  return Number.isFinite(n) ? n : -120.7;
};

/** The reading on one ebur128 stderr line, if it carries one. */
export const parseMeterLine = (line: string): MeterReading | undefined => {
  const m = line.match(READING);
  if (!m) return undefined;
  return {
    seconds: Number(m[1]),
    momentaryLufs: loudness(m[2]!),
    shortTermLufs: loudness(m[3]!),
  };
};

export type LevelMeter = {
  /** Quits the meter's ffmpeg.exe (killing it, by its tag, if `q` is not heard). */
  stop: () => Promise<void>;
};

export const startLevelMeter = (o: {
  launch: Launcher;
  /** ffmpeg.exe's args: the plain meter's, or a calibration run's capture. */
  args: string[];
  /** Where it runs: a calibration run's folder (WSL path). */
  cwd: string;
  /** A file to keep everything it prints in (a calibration run's log). */
  logFile?: string;
  onReading: (reading: MeterReading) => void;
  /** A frame's motion, when the process prints it (a calibration run's camera). */
  onMotion?: (point: MotionPoint) => void;
  /**
   * It quit without being asked: the last line it printed, if any, and the
   * last few lines that were not readings (where dshow says why it failed).
   */
  onExit: (lastLine: string | undefined, said: string) => void;
}): LevelMeter => {
  const p = o.launch({ tool: "ffmpeg", args: o.args, cwd: o.cwd });
  let stopping = false;
  const said: string[] = [];
  const log = o.logFile === undefined ? undefined : fs.openSync(o.logFile, "a");
  if (log !== undefined) {
    p.onStderr((chunk) => fs.writeSync(log, chunk));
    void p.exited.then(() => fs.closeSync(log));
  }
  const readMotion = motionLineReader();
  p.onStderr(
    lineSplitter((line) => {
      const reading = parseMeterLine(line);
      if (reading) return o.onReading(reading);
      const motion = readMotion(line);
      if (motion) return o.onMotion?.(motion);
      // A frame's motion is printed over two lines: neither says why it quit.
      if (!line.trim() || /\bpts_time:/.test(line)) return;
      said.push(line.trim());
      if (said.length > 20) said.shift();
    })
  );
  void p.exited.then(() => {
    if (!stopping) o.onExit(said.at(-1), said.join("\n"));
  });
  return {
    stop: () => {
      stopping = true;
      return quitProcess(p, { launch: o.launch, tag: METER_TAG });
    },
  };
};

/**
 * A calibration run in progress: its id, folder and files (WSL paths), its
 * camera, and its live clap marks once it is live.
 */
type CalibrationRun = {
  id: string;
  dir: string;
  micFile: string;
  cameraFile: string;
  camera: string;
  claps?: LiveClaps;
};

/**
 * The service's one level meter, run for one client (`Owner`, its socket) at
 * a time: started already, a start hands it to the client that asked. It
 * stops when asked or when that client goes, so a client that dies never
 * leaves the mic open and Record refused. Whether it may start at all (not
 * while recording) is the service's to decide.
 *
 * An AV Calibration's run takes the meter's place for a while: the same
 * mic, one process, now also opening the camera and writing both to files
 * (`calibration-run.ts`). The camera is borrowed from the service for the
 * run (its preview lets go of the Cam Link, which opens in one process at a
 * time) and given back when the run's process is gone. The run starts once
 * it is live: its first reading, which comes only once the camera has
 * opened; a process that quits before then is a refused start
 * (`CAM_LINK_IN_USE_TO_CALIBRATE` when dshow says another app holds the Cam
 * Link; the service never closes that app itself). Finished or
 * cancelled, the plain meter comes back for the same client; stopped, or its
 * client gone, the run is discarded with the meter. A discarded run leaves
 * no file.
 */
export const createMeterSide = <Owner>(o: {
  launch: Launcher;
  broadcast: (message: RecorderMessage) => void;
  /** Windows wall-clock ms, for a run's folder name and its files' T0. */
  now: () => number;
  /** The camera's DirectShow name; refuses when it is not listed. */
  findCamera: () => Promise<string>;
  /** How long a run may take to go live (the camera to open), in ms. */
  startTimeoutMs: number;
  /** Frees the camera for a run (the service's preview lets it go)... */
  takeCamera: () => Promise<void>;
  /** ...and has it back once the run's process is gone. */
  giveBackCamera: () => void;
}) => {
  let current:
    | { meter: LevelMeter; owner: Owner; mic: string; run?: CalibrationRun }
    | undefined;

  const findMic = async () => {
    const { devices } = await listDshowDevices(o.launch);
    const audio = devices.filter((d) => d.kind === "audio").map((d) => d.name);
    const mic = findByName(audio, (n) => n, MIC_NAME);
    if (!mic)
      throw new Refusal(
        `${MIC_NAME} (audio) is not among the DirectShow devices. Found: ${audio.join(", ") || "none"}`
      );
    return mic;
  };

  const discard = (run: CalibrationRun) => {
    run.claps?.stop();
    try {
      fs.rmSync(run.dir, { recursive: true, force: true });
    } catch (e) {
      console.error(`recorder: could not delete ${run.dir}`, e);
    }
  };

  const launchMeter = (owner: Owner, mic: string) => {
    const started = {
      owner,
      mic,
      meter: startLevelMeter({
        launch: o.launch,
        args: levelMeterArgs(mic),
        cwd: "/mnt/c",
        onReading: (reading) =>
          o.broadcast({ type: "meter-reading", ...reading }),
        onExit: (lastLine) => {
          if (current !== started) return;
          current = undefined;
          o.broadcast({
            type: "meter-stopped",
            message: `The level meter's ffmpeg quit${lastLine ? `: ${lastLine}` : "."}`,
          });
        },
      }),
    };
    current = started;
  };

  /**
   * Launches a run's capture in the meter's place. Answers once it is live
   * (its first reading), with the files' seconds then; rejects with why
   * when it quits before, or sends nothing within the start timeout (the
   * Cam Link's real trouble: it opens and sends nothing). Once live, a quit
   * discards the run.
   */
  const launchRun = (owner: Owner, mic: string, run: CalibrationRun) =>
    new Promise<number>((resolve, reject) => {
      const t0Ms = o.now();
      let live = false;
      const failToStart = (message: string) => {
        clearTimeout(timer);
        current = undefined;
        o.giveBackCamera();
        discard(run);
        reject(new Refusal(message));
      };
      const started = {
        owner,
        mic,
        run,
        meter: startLevelMeter({
          launch: o.launch,
          args: calibrationCaptureArgs({
            t0Ms,
            camera: run.camera,
            mic,
            micFile: CALIBRATION_MIC_FILE,
            cameraFile: CALIBRATION_CAMERA_FILE,
          }),
          cwd: run.dir,
          logFile: path.join(run.dir, CALIBRATION_CAPTURE_LOG),
          onReading: (reading) => {
            if (!live) {
              live = true;
              clearTimeout(timer);
              // The files' clock started at T0, before the camera opened:
              // their seconds now, a little after the first reading's.
              resolve(Math.max(reading.seconds, (o.now() - t0Ms) / 1000));
            }
            o.broadcast({ type: "meter-reading", ...reading });
            run.claps?.update();
          },
          onMotion: (point) => run.claps?.addMotion(point),
          onExit: (lastLine, said) => {
            if (current !== started) return;
            const message = `The AV Calibration's ffmpeg quit${lastLine ? `: ${lastLine}` : "."}`;
            // Another app has the Cam Link: Matt closes it (CVM never does)
            // and presses Start again.
            if (!live)
              return failToStart(
                saysDeviceBusy(said) ? CAM_LINK_IN_USE_TO_CALIBRATE : message
              );
            current = undefined;
            o.giveBackCamera();
            discard(run);
            o.broadcast({
              type: "calibration-ended",
              calibrationId: run.id,
              message,
            });
            o.broadcast({ type: "meter-stopped", message });
          },
        }),
      };
      current = started;
      const timer = setTimeout(() => {
        if (live || current !== started) return;
        void started.meter
          .stop()
          .finally(() => failToStart(CAM_LINK_NOT_STARTING));
      }, o.startTimeoutMs);
    });

  /** Ends a run's process; the caller brings the plain meter back. */
  const endRun = async () => {
    const ending = current;
    if (!ending?.run) throw new Refusal("No AV Calibration is running.");
    current = undefined;
    await ending.meter.stop();
    ending.run.claps?.stop();
    o.giveBackCamera();
    return ending as typeof ending & { run: CalibrationRun };
  };

  const stop = async () => {
    const stopped = current;
    if (!stopped) return;
    current = undefined;
    await stopped.meter.stop();
    if (stopped.run) {
      o.giveBackCamera();
      discard(stopped.run);
      o.broadcast({
        type: "calibration-ended",
        calibrationId: stopped.run.id,
        message: null,
      });
    }
    o.broadcast({ type: "meter-stopped", message: null });
  };

  return {
    running: () => current !== undefined,
    start: async (owner: Owner) => {
      if (current) {
        current.owner = owner;
        return;
      }
      const mic = await findMic();
      launchMeter(owner, mic);
      o.broadcast({ type: "meter-started", mic });
    },
    startCalibration: async (owner: Owner, folder: string) => {
      if (current?.run)
        throw new Refusal("An AV Calibration is already running.");
      if (!path.isAbsolute(folder))
        throw new Refusal(`The folder must be an absolute path: ${folder}`);
      const mic = current?.mic ?? (await findMic());
      const camera = await o.findCamera();
      const id = randomUUID();
      const stamp = new Date(o.now())
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-");
      const dir = path.join(
        folder,
        CALIBRATIONS_FOLDER,
        `${stamp} ${id.slice(0, 8)}`
      );
      fs.mkdirSync(dir, { recursive: true });
      const run: CalibrationRun = {
        id,
        dir,
        micFile: path.join(dir, CALIBRATION_MIC_FILE),
        cameraFile: path.join(dir, CALIBRATION_CAMERA_FILE),
        camera,
      };
      // One process holds the mic: the plain meter makes way for the run.
      const before = current;
      current = undefined;
      await before?.meter.stop();
      await o.takeCamera();
      let scriptStartSeconds: number;
      try {
        scriptStartSeconds = await launchRun(owner, mic, run);
      } catch (e) {
        // It never went live: the plain meter comes back, and Start is refused.
        launchMeter(owner, mic);
        throw e;
      }
      run.claps = createLiveClaps({
        micFile: run.micFile,
        window: runMeasurementWindows(scriptStartSeconds).claps,
        onMarks: (claps) =>
          o.broadcast({ type: "calibration-claps", calibrationId: id, claps }),
      });
      o.broadcast({
        type: "calibration-started",
        calibrationId: id,
        mic,
        micFile: run.micFile,
        camera,
        cameraFile: run.cameraFile,
        scriptStartSeconds,
      });
    },
    finishCalibration: async (windows: {
      silence: CalibrationWindow;
      speech: readonly CalibrationWindow[];
      claps: CalibrationWindow;
    }) => {
      const { run, owner, mic } = await endRun();
      try {
        const measured = await measureCalibration({
          launch: o.launch,
          dir: run.dir,
          ...windows,
        });
        o.broadcast({
          type: "calibration-measured",
          calibrationId: run.id,
          mic,
          micFile: run.micFile,
          camera: run.camera,
          cameraFile: run.cameraFile,
          ...measured,
        });
      } catch (e) {
        discard(run);
        const message = e instanceof Error ? e.message : String(e);
        o.broadcast({
          type: "calibration-ended",
          calibrationId: run.id,
          message,
        });
        throw new Refusal(message);
      } finally {
        launchMeter(owner, mic);
      }
    },
    cancelCalibration: async () => {
      const { run, owner, mic } = await endRun();
      discard(run);
      o.broadcast({
        type: "calibration-ended",
        calibrationId: run.id,
        message: null,
      });
      launchMeter(owner, mic);
    },
    stop,
    /** A client went: the meter (and any run) stops if it ran for that client. */
    ownerWent: (owner: Owner) =>
      current?.owner === owner ? stop() : Promise.resolve(),
  };
};

/** Where calibration runs go, under the recordings folder. */
export const CALIBRATIONS_FOLDER = "av-calibrations";
