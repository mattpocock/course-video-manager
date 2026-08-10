import { Effect } from "effect";
import { isLocalMachine, LOCAL_MACHINE_ENV_KEY } from "./env";
import { LocalOnlyCommandError } from "./errors";

/**
 * The machine gate for the verbs that need one.
 *
 * `cvm` reaches the domain data over HTTP from anywhere, but a few commands
 * need the AUTHOR'S MACHINE rather than the data: `cvm file` (the Video Files
 * directory), `cvm course readiness` (the finished videos directory) and
 * `cvm course publish` (both, plus ffmpeg). On a Remote Box they can never
 * work. They are refused rather than ported — see the ADR.
 *
 * TWO PROPERTIES MAKE THIS WORTH HAVING, and both are about what an agent does
 * next:
 *
 *   IT NAMES THE REASON. "this needs the finished videos directory" is
 *   something an agent can report and stop on. An `ENOENT` on a path it has
 *   never heard of is something it retries.
 *
 *   IT RUNS FIRST. Before the arguments are validated, before a row is read,
 *   before a byte is written — so a refused command cannot leave a Course
 *   half-changed, and the refusal is the same whatever else was wrong.
 */

/** What each local-only command needs, in the words its refusal will use. */
export const NEEDS_VIDEO_FILES_DIRECTORY =
  "it reads and writes the Video Files directory on this machine's disk";
export const NEEDS_FINISHED_VIDEOS_DIRECTORY =
  "it reads the finished videos directory on this machine's disk to work out which Videos are exported";
export const NEEDS_FINISHED_VIDEOS_AND_FFMPEG =
  "it renders Videos with ffmpeg and reads the finished videos directory on this machine's disk";

/**
 * Refuse `command` unless this is the author's machine.
 *
 * `Effect.suspend` matters: the check reads the environment at RUN time, so a
 * command that captures this guard at module load still asks the question when
 * it is actually invoked.
 */
export const requireLocalMachine = (
  command: string,
  reason: string
): Effect.Effect<void, LocalOnlyCommandError> =>
  Effect.suspend(() =>
    isLocalMachine()
      ? Effect.void
      : Effect.fail(
          new LocalOnlyCommandError({
            command,
            reason,
            message: `${command} needs the author's machine: ${reason}. This box is not it, so the command can never succeed here — stop rather than retry, and use a verb that reads the data instead. (If this IS the author's machine, set ${LOCAL_MACHINE_ENV_KEY}=true in the repo-root .env.)`,
          })
        )
  );
