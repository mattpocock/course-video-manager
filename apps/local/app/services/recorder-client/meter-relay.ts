import type {
  RecorderCommand,
  RecorderMessage,
} from "recorder-service/protocol";
import type { LevelMeterMessage } from "@/features/av-calibration/level-meter-wire";

type MeterListener = (message: LevelMeterMessage) => void;

/** The recorder service's messages about the meter. */
type MeterMessage = Extract<
  RecorderMessage,
  {
    type:
      | "meter-started"
      | "meter-reading"
      | "meter-stopped"
      | "calibration-started"
      | "calibration-claps"
      | "calibration-measured"
      | "calibration-ended";
  }
>;

export const isMeterMessage = (m: RecorderMessage): m is MeterMessage =>
  m.type === "meter-started" ||
  m.type === "meter-reading" ||
  m.type === "meter-stopped" ||
  m.type === "calibration-started" ||
  m.type === "calibration-claps" ||
  m.type === "calibration-measured" ||
  m.type === "calibration-ended";

/**
 * The recorder client's half of the level meter: passes the recorder
 * service's meter messages on to the AV Calibration pages listening. The
 * first page listening starts the meter, and the last one going stops it, at
 * once, so the mic is held only while a page is open.
 */
export const meterRelay = (o: {
  send: (command: RecorderCommand) => void;
  /** Why no command can reach the recorder service now; null when one can. */
  unavailable: () => string | null;
  /** A page started or stopped listening. */
  changed?: () => void;
}) => {
  const listeners = new Set<MeterListener>();
  const publish = (message: LevelMeterMessage) => {
    for (const listener of listeners) listener(message);
  };
  return {
    /** How many pages are listening. */
    listening: () => listeners.size,
    /**
     * Asks for the meter for the pages listening (the service came back), or
     * tells them why it cannot run.
     */
    restart() {
      if (listeners.size === 0) return;
      const why = o.unavailable();
      if (why) publish({ type: "meter-failed", message: why });
      else o.send({ type: "start-meter" });
    },
    /** The meter's messages, and a refused command (the meter's own, if it is). */
    hear(
      message: MeterMessage | Extract<RecorderMessage, { type: "refused" }>
    ) {
      switch (message.type) {
        case "meter-started":
          return publish({ type: "meter-started", mic: message.mic });
        case "meter-reading":
          return publish({
            type: "meter-reading",
            seconds: message.seconds,
            momentaryLufs: message.momentaryLufs,
            shortTermLufs: message.shortTermLufs,
          });
        case "meter-stopped":
          if (message.message)
            publish({ type: "meter-failed", message: message.message });
          return;
        case "calibration-started":
          return publish({
            type: "calibration-started",
            calibrationId: message.calibrationId,
            mic: message.mic,
            scriptStartSeconds: message.scriptStartSeconds,
          });
        case "calibration-claps":
          return publish({
            type: "calibration-claps",
            calibrationId: message.calibrationId,
            claps: message.claps,
          });
        // The finish's own answer, to the recorder client's waiter.
        case "calibration-measured":
          return;
        case "calibration-ended":
          // Cancelled or stopped on purpose: nothing to say.
          if (message.message)
            publish({
              type: "calibration-failed",
              calibrationId: message.calibrationId,
              message: message.message,
            });
          return;
        case "refused":
          if (message.command === "start-meter")
            publish({ type: "meter-failed", message: message.message });
          return;
      }
    },
    subscribe(listener: MeterListener) {
      listeners.add(listener);
      o.changed?.();
      // Again for each page: started already, the service carries on.
      const why = o.unavailable();
      if (why) listener({ type: "meter-failed", message: why });
      else o.send({ type: "start-meter" });
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) o.send({ type: "stop-meter" });
        o.changed?.();
      };
    },
  };
};
