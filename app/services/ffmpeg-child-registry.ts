/**
 * Parent-death backstop for long-running ffmpeg children.
 *
 * Effect scopes already kill an ffmpeg child when its *fiber* is interrupted
 * (SSE disconnect, cancelled publish). What scopes cannot cover is the parent
 * process itself dying — Ctrl-C on the dev server exits Node without
 * interrupting any fiber, orphaning the child. This registry tracks live
 * ffmpeg PIDs and installs one-time signal/exit handlers that reap whatever
 * is still registered on the way down.
 *
 * A hard SIGKILL of the parent (or a native crash) still orphans children —
 * nothing in userland prevents that.
 */
const livePids = new Set<number>();
let handlersInstalled = false;

const killAll = () => {
  for (const pid of livePids) {
    try {
      // SIGKILL: the outputs are throwaway temp files, so there is nothing
      // worth letting ffmpeg finalize — just make sure it dies.
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  livePids.clear();
};

const installHandlers = () => {
  if (handlersInstalled) return;
  handlersInstalled = true;

  // Fires on process.exit() and normal event-loop drain — including the exit
  // that dev-server tooling (vite etc.) performs from its own signal handlers.
  process.once("exit", killAll);

  // If nothing else handles the signal, Node would terminate without firing
  // "exit" — so kill the children ourselves, then re-raise the signal with our
  // once-handler consumed so the default (or any other handler) proceeds.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      killAll();
      process.kill(process.pid, signal);
    });
  }
};

/** Track a spawned ffmpeg child; returns the untrack function. */
export const registerFfmpegChild = (pid: number): (() => void) => {
  installHandlers();
  livePids.add(pid);
  return () => {
    livePids.delete(pid);
  };
};
