import { Effect, Layer } from "effect";
import { recorderBusy, recorderHealth } from "recorder-service/health";
import { recorderServiceUrl } from "./recorder-client/recorder-service-url";
import { makeStillGate, StillGate, type RecordingSignal } from "./still-gate";

/**
 * The Still Gate for a process that is not the app server — the `cvm` frame
 * commands. It has no recorder client to hear Record and Stop on, so it asks
 * the recorder service's `/health` instead: busy while it records or a
 * stopped take is still closing its files (`recorderBusy`). A read of
 * `/health` opens no device and takes the recorder from no Video.
 *
 * Which service: `RECORDER_SERVICE_URL` (a fake a test starts), else Matt's,
 * from any checkout and any working directory. The app server only connects
 * to his from the main checkout, because a client of it fights his editor; a
 * probe cannot, and a gate that read "idle" because `cvm` ran from another
 * directory would let a decode cost a live take its camera frames. An
 * agent's process (`realDrivesForbidden`) gets the dead address, as the app
 * server's does: it can read none of Matt's Footage anyway.
 */
export const stillGateRecorderUrl = (
  env: Readonly<Record<string, string | undefined>>
): string => recorderServiceUrl({ env, mainCheckout: () => true });

/** How often a decode in flight asks again, so a Record that starts stops it. */
const POLL_MS = 500;

/**
 * A {@link RecordingSignal} read from `busy()`: once up front, then every
 * {@link POLL_MS} while anything listens (the gate listens only while a
 * decode runs).
 */
const polledSignal = (
  initial: boolean,
  busy: () => Promise<boolean>
): RecordingSignal => {
  let recording = initial;
  const listeners = new Set<(recording: boolean) => void>();
  let timer: NodeJS.Timeout | undefined;
  const poll = () => {
    void busy().then((now) => {
      if (now === recording) return;
      recording = now;
      for (const listener of listeners) listener(now);
    });
  };
  return {
    recording: () => recording,
    onRecordingChange: (listener) => {
      listeners.add(listener);
      if (!timer) {
        timer = setInterval(poll, POLL_MS);
        timer.unref();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !timer) return;
        clearInterval(timer);
        timer = undefined;
      };
    },
  };
};

/** The Still Gate on the recorder service at `url` (a `ws://host:port`). */
export const recorderStillGateLayer = (url: string) =>
  Layer.effect(
    StillGate,
    Effect.gen(function* () {
      const port = Number(new URL(url).port);
      // `recorderHealth` never rejects: anything but a recorder's answer is
      // "nothing" or "something-else", neither of which records.
      const busy = () => recorderHealth(port).then(recorderBusy);
      const initial = yield* Effect.async<boolean>((resume) => {
        void busy().then((now) => resume(Effect.succeed(now)));
      });
      return { run: makeStillGate(polledSignal(initial, busy)) };
    })
  );
