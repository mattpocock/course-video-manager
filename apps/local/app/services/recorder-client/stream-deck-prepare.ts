import type { RecorderCommand } from "recorder-service/protocol";
import type { SilenceLength } from "@/silence-detection-constants";
import type { LastPassedCalibration } from "@/av-calibration-constants";

/**
 * What a Stream Deck Record on the open Video records with, as the recorder
 * client (`client.server.ts`) tells the recorder service: the Video's editor's
 * Silence Length, the recordings folder, and the latest AV Calibration
 * passed under today's rules, read when the recorder is prepared. The service
 * gates the press itself (ADR 0038), so a calibration that expires while the
 * recorder stays prepared still stops a Record. Sent again whenever
 * the Video or its Silence Length changes, the connection is new, or an AV
 * Calibration is stored (`forget`, then `prepare`).
 */
export const streamDeckPreparation = (o: {
  send: (command: RecorderCommand) => void;
  calibration: () => Promise<LastPassedCalibration | null>;
  folder: string;
}) => {
  /** Per Video: its editor's Silence Length. */
  const silenceLengths = new Map<string, SilenceLength>();
  /** The Video and Silence Length the recorder was last prepared with. */
  let prepared: string | undefined;
  /** Bumped whenever `prepared` is let go, so a slow calibration read is dropped. */
  let attempts = 0;

  const forget = () => {
    prepared = undefined;
    attempts++;
  };

  /** Prepares the recorder open for `videoId` (none: it is closed or unreachable). */
  const prepare = (videoId: string | undefined) => {
    if (!videoId) return forget();
    const silenceLength = silenceLengths.get(videoId);
    const key = `${videoId}:${silenceLength}`;
    if (!silenceLength || prepared === key) return;
    prepared = key;
    const attempt = ++attempts;
    void o
      .calibration()
      .then((calibration) => {
        if (attempt !== attempts) return;
        o.send({
          type: "prepare-record",
          videoId,
          silenceLength,
          folder: o.folder,
          calibration,
        });
      })
      .catch((error: unknown) => {
        if (attempt === attempts) prepared = undefined;
        console.error(
          "recorder client: could not read the AV Calibration",
          error
        );
      });
  };

  return {
    prepare,
    forget,
    setSilenceLength: (videoId: string, silenceLength: SilenceLength) =>
      void silenceLengths.set(videoId, silenceLength),
  };
};
