import type { Launcher } from "./launcher";
import { hearingFeedOverflows } from "./stream-feeds";
import { Refusal } from "./refusal";
import { armTake, type ArmedTake } from "./recording-session";
import { sameTake, type TakeSettings } from "./take-settings";

/** How long Record waits for a writer it had to arm on the spot. */
const ARM_TIMEOUT_MS = 10_000;

/** How long after an armed writer quits before another is armed. */
const REARM_DELAY_MS = 1_000;

/**
 * THE NEXT TAKE'S WRITER (#2207): kept armed on the live camera capture's
 * relay, with what the next take would record with (`wanted`), so Record
 * only has to tell it T0. One at a time: the relay takes one writer, so a
 * writer armed with other settings quits before the next one starts.
 */
export const createTakeArming = (o: {
  launch: Launcher;
  /** Windows wall-clock ms. */
  now: () => number;
  /** What the next take records with, if one can be armed now. */
  wanted: () => TakeSettings | undefined;
  /** A streamed take's feed to the Live Stream overflowed (#2525). */
  onFeedOverflow: () => void;
}) => {
  let armed: ArmedTake | undefined;

  const arm = (settings: TakeSettings) => {
    const take: ArmedTake = armTake({
      // A streamed take's processes are heard for their feeds' overflows.
      launch: settings.streamed
        ? hearingFeedOverflows(o.launch, o.onFeedOverflow)
        : o.launch,
      now: o.now,
      settings,
      onQuit: (errors) => {
        if (armed !== take) return;
        armed = undefined;
        console.error(
          `recorder: the armed camera writer quit before Record${errors.length ? `: ${errors.join(" ")}` : ""}; arming another`
        );
        setTimeout(rearm, REARM_DELAY_MS);
      },
    });
    armed = take;
    return take;
  };

  /** Quits the armed writer, if any; done once its folder is gone. */
  const disarm = async () => {
    const take = armed;
    armed = undefined;
    await take?.disarm();
  };

  /** Arms what `wanted` says, if it is not armed already; none if it says none. Not awaited. */
  function rearm() {
    const wanted = o.wanted();
    if (armed && (!wanted || !sameTake(armed.settings, wanted))) {
      const old = armed;
      armed = undefined;
      void old.disarm().then(rearm);
      return;
    }
    if (!armed && wanted) arm(wanted);
  }

  return {
    rearm,
    disarm,
    /**
     * Arms a writer with these settings now, the one armed with others quit
     * first (Go Live arms a streamed writer before it starts the stream).
     * Done once it is starting; `takeFor` waits for it to be ready.
     */
    prepare: async (settings: TakeSettings) => {
      if (armed && !sameTake(armed.settings, settings)) await disarm();
      if (!armed) arm(settings);
    },
    /** Whether a writer is armed now. */
    isArmed: () => armed !== undefined,
    /**
     * The writer for a take with these settings, ready to begin: the armed
     * one, or one armed now and waited for. Refuses when none starts.
     */
    takeFor: async (settings: TakeSettings): Promise<ArmedTake> => {
      if (armed && !sameTake(armed.settings, settings)) await disarm();
      const take = armed ?? arm(settings);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          take.ready,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("it did not connect in time")),
              ARM_TIMEOUT_MS
            );
          }),
        ]);
      } catch (e) {
        if (armed === take) await disarm();
        throw new Refusal(
          `The camera writer did not start: ${e instanceof Error ? e.message : String(e)}`
        );
      } finally {
        clearTimeout(timer);
      }
      if (armed === take) armed = undefined;
      return take;
    },
  };
};

/** Record's log line: how long each step to T0 took, and how the writer was armed. */
export const recordTook = (o: {
  startedMs: number;
  devicesMs: number;
  screenMs: number;
  armedMs: number;
  fromCache: boolean;
  wasArmed: boolean;
  relayWasHeld: boolean;
}) =>
  `recorder: Record took ${o.armedMs - o.startedMs} ms to T0 (devices ${o.devicesMs - o.startedMs} ms${o.fromCache ? ", cached" : ""}, screen ${o.screenMs - o.devicesMs} ms, writer ${o.armedMs - o.screenMs} ms, ${o.wasArmed && o.armedMs - o.screenMs < 5 ? "armed" : o.relayWasHeld ? "armed at Record: the last take's writer still held the relay" : "armed at Record"}); no device reopened, preview untouched`;
