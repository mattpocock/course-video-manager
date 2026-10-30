import { MIC_NAME } from "../app/mic-device";
import {
  calibrationValidity,
  describeCalibrationRefusal,
  RECORDER_CAMERA_NAME,
  type LastPassedCalibration,
} from "../app/av-calibration-constants";
import type { Launcher } from "./launcher";
import { findByName, Refusal } from "./refusal";
import { listDshowDevices } from "./windows-devices";

type Listing = Awaited<ReturnType<typeof listDshowDevices>>;

/**
 * THE DIRECTSHOW DEVICES THE RECORDER RECORDS, as last listed. Every try at
 * the Cam Link lists them (open, the reopen after a take, Retry, the meter),
 * so Record reads the camera + mic pair from that listing instead of
 * spawning ffmpeg.exe again (#2187). Safe stale: ffmpeg opens a dshow device
 * by its name, so one gone since makes the recorder fail loudly, never
 * record another device. A listing Record would refuse is listed afresh
 * first, in case a device came back since.
 */
export const createRecordingDevices = (launch: Launcher) => {
  let listed: Listing | undefined;
  const list = async () => (listed = await listDshowDevices(launch));

  /** The camera + mic a listing names, and the calibration gate on that pair. */
  const pairIn = (
    listing: Listing,
    calibration: LastPassedCalibration | null,
    nowMs: number
  ) => {
    const names = (kind: "video" | "audio") =>
      listing.devices.filter((d) => d.kind === kind).map((d) => d.name);
    const camera = findByName(names("video"), (n) => n, RECORDER_CAMERA_NAME);
    const mic = findByName(names("audio"), (n) => n, MIC_NAME);
    // THE GATE (ADR 0038), at the one moment it applies: the start. The
    // camera + mic pair is compared here because only the service knows
    // which pair it records.
    const gate =
      camera && mic
        ? calibrationValidity(calibration, { recorderMic: mic, camera }, nowMs)
        : undefined;
    return { ...listing, camera, mic, gate };
  };

  return {
    /** The Cam Link's DirectShow name, from a fresh listing. */
    findCamera: async () =>
      findByName(
        (await list()).devices
          .filter((d) => d.kind === "video")
          .map((d) => d.name),
        (n) => n,
        RECORDER_CAMERA_NAME
      ),
    /**
     * The Cam Link's and the mic's DirectShow names, from a fresh listing:
     * the camera capture opens both (#2207).
     */
    findPair: async () => {
      const names = (kind: "video" | "audio") =>
        listing.devices.filter((d) => d.kind === kind).map((d) => d.name);
      const listing = await list();
      return {
        camera: findByName(names("video"), (n) => n, RECORDER_CAMERA_NAME),
        mic: findByName(names("audio"), (n) => n, MIC_NAME),
      };
    },
    /**
     * The pair Record records, gated; refuses with why, and when it is not
     * the pair the recorder `opened`.
     */
    forRecord: async (
      calibration: LastPassedCalibration | null,
      now: () => number,
      opened?: { camera: string; mic: string }
    ) => {
      const cached = listed && pairIn(listed, calibration, now());
      const fromCache = cached?.gate?.valid === true;
      const { devices, raw, camera, mic, gate } =
        fromCache && cached ? cached : pairIn(await list(), calibration, now());
      if (!camera || !mic || !gate) {
        const missing = !camera
          ? `${RECORDER_CAMERA_NAME} (video)`
          : `${MIC_NAME} (audio)`;
        throw new Refusal(
          `${missing} is not among the DirectShow devices. Found: ${devices.map((d) => `${d.name} (${d.kind})`).join(", ") || `none. ffmpeg said: ${raw.slice(0, 500)}`}`
        );
      }
      if (!gate.valid)
        throw new Refusal(describeCalibrationRefusal(gate.reason));
      if (opened && (camera !== opened.camera || mic !== opened.mic))
        throw new Refusal(
          `The recorder opened ${opened.camera} and ${opened.mic}, but the devices now listed are ${camera} and ${mic}: close the recorder and open it again.`
        );
      return { camera, mic, calibration: gate.calibration, fromCache };
    },
  };
};
