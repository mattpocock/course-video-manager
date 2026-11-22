import fs from "node:fs";
import path from "node:path";
import { Cause, HashMap, Inspectable, Logger } from "effect";
import { assertUnder } from "@/services/assert-under";
import { now } from "@/packages/clock";

/**
 * The sidecar's one logger: a JSON object per line.
 *
 * Every line goes to stdout, which `scripts/run-with-log.sh` tees into
 * `.data/logs/dev-*.log` beside the app's output. A line logged while a Job
 * runs carries the Job's annotations (`jobId`, `kind`, `attempt`, `subject`,
 * set by the worker), and is ALSO appended to `<logDir>/<jobId>.jsonl` — so
 * "why did that job fail?" is one file, not a grep through a day of output.
 */
export interface JsonLogLine {
  readonly at: string;
  readonly level: string;
  readonly message: unknown;
  readonly cause?: string;
  readonly [annotation: string]: unknown;
}

const messageOf = (message: unknown): unknown =>
  Array.isArray(message) && message.length === 1 ? message[0] : message;

export const formatLogLine = (options: Logger.Logger.Options<unknown>) => {
  const line: Record<string, unknown> = {
    at: options.date.toISOString(),
    level: options.logLevel.label,
    message: messageOf(options.message),
  };
  for (const [key, value] of HashMap.toEntries(options.annotations)) {
    line[key] = value;
  }
  if (!Cause.isEmpty(options.cause)) {
    line.cause = Cause.pretty(options.cause, { renderErrorCause: true });
  }
  return line as JsonLogLine;
};

/**
 * A logger writing to `write` (stdout in production) and to the Job's own
 * file under `logDir`. A log line must never throw, so a file that cannot be
 * written costs that line in the file, and says so on stdout.
 */
export const makeJsonLogger = (opts: {
  readonly logDir: string;
  readonly write: (text: string) => void;
}) =>
  Logger.make((options) => {
    const line = formatLogLine(options);
    const text = `${Inspectable.stringifyCircular(line)}\n`;
    opts.write(text);
    const jobId = line.jobId;
    if (typeof jobId !== "string") return;
    try {
      const file = assertUnder(
        opts.logDir,
        path.join(opts.logDir, `${jobId}.jsonl`)
      );
      fs.appendFileSync(file, text);
    } catch (error) {
      opts.write(
        `${Inspectable.stringifyCircular({
          at: now().toISOString(),
          level: "WARN",
          message: `could not append to the job log for ${jobId}`,
          cause: String(error),
        })}\n`
      );
    }
  });

/** The job log file a Job's lines land in. */
export const jobLogPath = (logDir: string, jobId: string) =>
  path.join(logDir, `${jobId}.jsonl`);
