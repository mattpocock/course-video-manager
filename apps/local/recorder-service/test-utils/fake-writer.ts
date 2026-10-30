import type { FakeProcess } from "./fake-windows";

/**
 * A take's camera writer, as ffmpeg 8 runs one: it reads the relay at once,
 * but its filter graph comes up only `writerGraphMs` later (default 20), at
 * its first frames. Until then it drops every command it is sent, Record's
 * T0 too, without a word (#2482); after, it answers one sent now (`-1`).
 * Its first frame comes once it has heard T0.
 */
export const armedWriter = (
  p: FakeProcess,
  relay: number,
  o: { writerGraphMs?: number; recordingCamera?: "frames" | "silent" }
) => {
  setImmediate(() =>
    p.stderr(
      `[info] Input #0, matroska,webm, from 'tcp://127.0.0.1:${relay}?listen=1&tcp_nodelay=1':\r\n`
    )
  );
  let graphUp = false;
  setTimeout(() => (graphUp = true), o.writerGraphMs ?? 20);
  p.onStdin = (text) => {
    if (!text.startsWith("Call ") || !graphUp) return;
    if (text.startsWith("Call -1 "))
      return p.stderr("Command reply for stream 0: ret:0 res:\n");
    p.begun = true;
    if (o.recordingCamera !== "silent")
      setImmediate(() =>
        p.stdout("frame=1\nout_time_us=0\nprogress=continue\n")
      );
  };
};
