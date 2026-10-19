import type { RecordingSession } from "./recording-session";

/**
 * TAKES STOPPING (#2211, ADR 0048). Stop lets a take go at the press, as OBS
 * does: the recorder is open again at once, and the take closes its files
 * in the background (`RecordingSession.stop`), keeping everything up to the
 * press. Until its writer has quit, it holds the capture's writer relay,
 * where the next take's writer listens: that one is armed once it lets go.
 */
export const createTakeStopping = (o: {
  /** Arms the next take's writer, now that the relay is free. */
  rearm: () => void;
}) => {
  const finishing = new Set<Promise<void>>();
  let relayHeld: Promise<void> | undefined;
  return {
    /** Lets `take` go at once; it closes its files in the background. */
    stop: (take: RecordingSession) => {
      const pressedMs = Date.now();
      const writerQuit: Promise<void> = take.writerQuit.then(() => {
        if (relayHeld === writerQuit) relayHeld = undefined;
        o.rearm();
      });
      relayHeld = writerQuit;
      const closed = take.stop().then(
        () =>
          console.log(
            `recorder: the take finalised ${Date.now() - pressedMs} ms after Stop (${take.id})`
          ),
        (e: unknown) =>
          console.error(`recorder: the take ${take.id} failed to stop`, e)
      );
      finishing.add(closed);
      void closed.finally(() => finishing.delete(closed));
    },
    /** Whether a stopped take's writer still holds the relay. */
    relayHeld: () => relayHeld !== undefined,
    /** Done once no stopped take's writer holds the relay. */
    relayFree: () => relayHeld ?? Promise.resolve(),
    /** Whether a stopped take is still closing its files. */
    closing: () => finishing.size > 0,
    /** Done once every stopped take has closed its files. */
    finished: () => Promise.all(finishing).then(() => {}),
  };
};
