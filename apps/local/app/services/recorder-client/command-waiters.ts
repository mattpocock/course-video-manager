import type {
  RecorderCommand,
  RecorderMessage,
} from "recorder-service/protocol";
import {
  RecorderRefusedError,
  RecorderUnavailableError,
  NOT_RUNNING,
} from "./recorder-command";

type Waiter = {
  command: RecorderCommand["type"];
  done: (message: RecorderMessage) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

/**
 * The recorder client's commands that wait (`client.server.ts`): each is
 * sent, then settles on the message that says it was carried out, a refusal
 * of it, the service going away, or `timeoutMs`.
 */
export const commandWaiters = (o: {
  send: (command: RecorderCommand) => void;
  /** Whether a command can reach the recorder service now. */
  connected: () => boolean;
  timeoutMs: number;
}) => {
  let waiters: Waiter[] = [];
  const remove = (waiter: Waiter) => {
    waiters = waiters.filter((w) => w !== waiter);
  };
  return {
    /** Sends a command and waits until the recorder has carried it out. */
    command: (
      sent: RecorderCommand,
      done: (message: RecorderMessage) => boolean
    ) =>
      new Promise<void>((resolve, reject) => {
        if (!o.connected()) {
          reject(new RecorderUnavailableError(NOT_RUNNING));
          return;
        }
        const timer = setTimeout(() => {
          remove(waiter);
          reject(
            new RecorderUnavailableError(
              `The recorder service did not answer ${sent.type}.`
            )
          );
        }, o.timeoutMs);
        const waiter: Waiter = {
          command: sent.type,
          done,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        waiters.push(waiter);
        o.send(sent);
      }),
    /** Every message from the service, before anything else hears it. */
    hear: (message: RecorderMessage) => {
      for (const waiter of waiters.slice()) {
        if (message.type === "refused" && message.command === waiter.command) {
          remove(waiter);
          waiter.reject(new RecorderRefusedError(message.message));
        } else if (waiter.done(message)) {
          remove(waiter);
          waiter.resolve();
        }
      }
    },
    /** The service went away: every command waiting fails. */
    wentAway: () => {
      for (const waiter of waiters.splice(0))
        waiter.reject(
          new RecorderUnavailableError("The recorder service went away.")
        );
    },
  };
};
