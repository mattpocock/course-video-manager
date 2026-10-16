import type { DB } from "@/db/schema";
import type { ClipService } from "@/services/clip-service";
import { VERSION_NOT_DRAFT_MESSAGE } from "@/services/version-not-draft-message";
import type { TakeSaver } from "./take-saver";

/** How often OBS's file is polled for the Clips its speech made. */
export const OBS_POLL_MS = 500;

/**
 * OBS's `TakeSaver`: polls the Recording Session's file for Clips
 * (`appendFromObs`), saved where the editor says at each poll, until the
 * clip reducer is done with the Session.
 */
export const obsTakeSaver =
  (o: {
    videoId: string;
    appendFromObs: ClipService["appendFromObs"];
  }): TakeSaver =>
  (session, takes) => {
    let unmounted = false;
    void (async () => {
      while (!unmounted) {
        // Stop polling when session is done
        if (takes.isDone()) break;
        try {
          const clips = await o.appendFromObs({
            videoId: o.videoId,
            filePath: session.outputPath,
            ...takes.where(),
            silenceLength: session.silenceLength,
            silenceThresholdDb: session.silenceThresholdDb,
          });
          if (clips.length > 0)
            takes.saved(clips as DB.Clip[], crypto.randomUUID());
        } catch (e) {
          // Terminal (#1403): the version was Submitted mid-session — stop
          // polling and surface the reload overlay instead of silently
          // retrying against a frozen version forever.
          if (e instanceof Error && e.message === VERSION_NOT_DRAFT_MESSAGE) {
            takes.failed(e.message);
            break;
          }
          // Other errors are swallowed; polling continues
        }
        await new Promise((resolve) => setTimeout(resolve, OBS_POLL_MS));
      }
    })();
    return () => {
      unmounted = true;
    };
  };
