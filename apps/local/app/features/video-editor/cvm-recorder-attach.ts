import type { cvmRecorderReducer } from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";

/**
 * Attaching (#2182): as OBS's connector stops a recording it finds and does
 * not follow when it connects (`obs-connected`), the first reachable `recorder-status` a
 * page hears asks the recorder to Stop if it names a Recording Session. A
 * take left going by a page that was refreshed or closed is stopped by the
 * next page; its speech up to the stop is still placed. A later status (a
 * reconnect) never stops anything. The page also sends Stop as it goes away
 * (`use-cvm-recorder.ts`), so a refresh stops at once.
 */
export const attach = (
  next: cvmRecorderReducer.State,
  message: CvmRecorderMessage,
  exec: (effect: cvmRecorderReducer.Effect) => void
): cvmRecorderReducer.State => {
  if (
    next.attached ||
    message.type !== "recorder-status" ||
    next.reachable !== true
  )
    return next;
  if (next.phase !== "recording") return { ...next, attached: true };
  exec({ type: "stop-recording" });
  return { ...next, attached: true, phase: "stopping" };
};
