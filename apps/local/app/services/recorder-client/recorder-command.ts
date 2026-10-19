import { Data, Effect } from "effect";

/** Why a recorder client command (`client.server.ts`) did not happen. */

export class RecorderUnavailableError extends Error {}

/** Why nothing reaches the recorder service: nothing answers on its port. */
export const NOT_RUNNING =
  "The recorder service is not running. Opening a video editor starts it, from the main checkout.";
export class RecorderRefusedError extends Error {}

/** Record or Stop was refused, or the recorder service did not answer. */
export class RecorderCommandError extends Data.TaggedError(
  "RecorderCommandError"
)<{ readonly message: string; readonly cause: unknown }> {}

/** A recorder client call, as an Effect a route can run. */
export const recorderCommand = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new RecorderCommandError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
