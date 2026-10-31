import { EventEmitter } from "node:events";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import { LIVE_STREAM_SETTINGS } from "recorder-service/go-live";
import { startRecorderService } from "recorder-service/recorder-service";
import { recorderBusy, recorderHealth } from "recorder-service/health";
import { IDLE_STOP } from "recorder-service/protocol";
import { stopCleanlyOn } from "recorder-service/run-recorder-service";
import { fakeWindows } from "recorder-service/test-utils/fake-windows";
import { clock } from "recorder-service/test-utils/service-harness";
import { setupClipServiceTests, clipService } from "../clip-service-test-setup";
import { connectClient, tmp } from "./recorder-client-test-harness";
import {
  RECORDER_IDLE_MS,
  type RecorderServiceLauncher,
} from "./service-on-demand";

/**
 * The recorder service on demand (ADR 0053), end to end without hardware:
 * the app server's recorder client starting the real recorder service, on a
 * scripted Windows, when an editor opens, and stopping it once no editor
 * has been open for the idle time — never mid-take.
 */

setupClipServiceTests();

const IDLE_MS = 300;

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

const stopAll: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stopAll.splice(0)) await stop();
});

/** Starts the service in-process, as `service-process.server.ts` starts Matt's. */
const launcherOn = (port: number) => {
  const windows = fakeWindows();
  const stateDir = tmp();
  const log = { starts: 0, stops: 0 };
  const launcher: RecorderServiceLauncher = {
    start: async () => {
      log.starts++;
      const service = await startRecorderService({
        port,
        launch: windows.launch,
        now: () => clock.ms,
        stateDir,
        cameraStartTimeoutMs: 100,
        wakeSpacedesk: windows.wakeSpacedesk,
        ...LIVE_STREAM_SETTINGS,
      });
      let closing: Promise<void> | undefined;
      const close = () => (closing ??= service.close());
      stopAll.push(close);
      // The IPC channel `service-process.ts` hears the idle stop on.
      const ipc = new EventEmitter();
      const exited = stopCleanlyOn(
        { close, busy: service.busy },
        ipc,
        () => {}
      ).then(() => void log.stops++);
      return { stopIfIdle: () => ipc.emit("message", IDLE_STOP), exited };
    },
    busy: async () => recorderBusy(await recorderHealth(port)),
  };
  return { launcher, windows, log };
};

const setup = async () => {
  const port = await freePort();
  const { launcher, log } = launcherOn(port);
  const client = connectClient(port, undefined, undefined, undefined, {
    launcher,
    idleMs: IDLE_MS,
  });
  const video = await clipService.createVideo("CVM recorder");
  const heard: CvmRecorderMessage[] = [];
  const open = () => client.subscribe(video.id, (m) => heard.push(m));
  return { client, log, video, heard, open };
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the recorder service on demand", () => {
  it("idles out 2 minutes after nothing needs it (#2383)", () => {
    expect(RECORDER_IDLE_MS).toBe(2 * 60_000);
  });

  it("starts only when an editor opens, says so while it starts, and stops once no editor has been open for the idle time", async () => {
    const { log, heard, open } = await setup();
    await wait(IDLE_MS);
    expect(log.starts).toBe(0);

    const leave = open();
    await vi.waitFor(() =>
      expect(heard).toContainEqual(
        expect.objectContaining({ type: "recorder-status", starting: true })
      )
    );
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    expect(log.starts).toBe(1);

    leave();
    await vi.waitFor(() => expect(log.stops).toBe(1));
  });

  it("keeps running when an editor comes back within the idle time", async () => {
    const { log, heard, open } = await setup();
    const leave = open();
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    leave();
    await wait(IDLE_MS / 3);
    open();
    await wait(IDLE_MS * 3);
    expect(log).toEqual({ starts: 1, stops: 0 });
  });

  it("never stops while a take records, with no editor open; once stopped, it idles out", async () => {
    const { client, log, video, heard, open } = await setup();
    const leave = open();
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    await client.startRecording(video.id, {
      silenceLength: "short",
      folder: tmp(),
    });
    leave();
    await wait(IDLE_MS * 4);
    expect(log.stops).toBe(0);
    expect(client.recording()).toBe(true);

    await client.stopRecording(video.id);
    await vi.waitFor(() => expect(log.stops).toBe(1));
  });
});
