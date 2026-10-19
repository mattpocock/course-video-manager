/**
 * IDLE STOP: the one lifecycle shared by the on-demand processes the app
 * starts — the **Local Whisper** worker (`sidecar/local-whisper-engine.ts`)
 * and the recorder service (`recorder-client/service-on-demand.ts`). Each is
 * started when something needs it and stopped once it has gone unneeded for
 * `idleMs`.
 *
 * `arm()` starts (or restarts) the count; `cancel()` stops it, for as long as
 * something needs the process again. When the count runs out:
 *
 * - while `heldUntil()` is in the future, it counts again until then (a hold,
 *   such as the recorder's on Whisper);
 * - while `busy()` (a take recording, a file being transcribed), it looks
 *   again every `busyPollMs`, and once that work is done the whole `idleMs`
 *   starts again;
 * - otherwise `onIdle()` stops the process.
 */
export const createIdleStop = (o: {
  idleMs: number;
  onIdle: () => void;
  busy?: () => boolean | Promise<boolean>;
  busyPollMs?: number;
  /** Epoch ms until which the process is held, whatever else. */
  heldUntil?: () => number;
}) => {
  let timer: NodeJS.Timeout | null = null;
  /** Bumped by every arm and cancel, so a `busy()` answer that arrives late is dropped. */
  let generation = 0;

  const schedule = (ms: number, then: () => void) => {
    timer = setTimeout(then, ms);
    timer.unref();
  };

  const cancel = () => {
    generation++;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const arm = () => {
    cancel();
    const held = (o.heldUntil?.() ?? 0) - Date.now();
    schedule(Math.max(o.idleMs, held), () => void expire(generation, false));
  };

  const expire = async (mine: number, wasBusy: boolean) => {
    timer = null;
    if ((o.heldUntil?.() ?? 0) > Date.now()) return arm();
    const busy = (await o.busy?.()) ?? false;
    if (mine !== generation) return;
    if (busy)
      return schedule(o.busyPollMs ?? 1_000, () => void expire(mine, true));
    if (wasBusy) return arm();
    o.onIdle();
  };

  return {
    arm,
    cancel,
    /** Whether the count (or a wait for busy work) is running. */
    armed: () => timer !== null,
  };
};
