import { lineSplitter, type LaunchedProcess } from "./launcher";
import { graphUpCommand } from "./take-args";

/** What the writer prints once it has the relay: its input opened. */
const READS_RELAY = /Input #0, .*from 'tcp:/;

/** ffmpeg's answer to a command sent now: its filter graph is up. */
const GRAPH_ANSWERED = /Command reply for stream/;

/** How often the writer is asked, once it reads the relay. */
const ASK_EVERY_MS = 100;

/**
 * THE ARMED WRITER IS READY (#2207, #2482) once it reads the relay AND its
 * filter graph is up. ffmpeg 8 builds the graph only at its first frames,
 * and until then drops every command it is sent, without a word: a T0 sent
 * the moment the relay opened (a writer armed at Record, as Go Live's always
 * is) was lost, and camera.mkv and mic.mkv stayed empty for the whole take,
 * the Live Stream's camera feed with them. So it is asked a command that
 * changes nothing (`graphUpCommand`) until it answers. Rejects if it quits
 * first, with `why`.
 */
export const writerGraphUp = (
  child: LaunchedProcess,
  why: () => string
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let asking: ReturnType<typeof setInterval> | undefined;
    const ask = () => child.writeStdin(graphUpCommand);
    child.onStderr(
      lineSplitter((line) => {
        if (READS_RELAY.test(line) && !asking) {
          ask();
          asking = setInterval(ask, ASK_EVERY_MS);
        } else if (GRAPH_ANSWERED.test(line)) {
          clearInterval(asking);
          resolve();
        }
      })
    );
    void child.exited.then(() => {
      clearInterval(asking);
      reject(new Error(why()));
    });
  });
