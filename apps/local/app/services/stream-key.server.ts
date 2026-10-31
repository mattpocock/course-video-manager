import { Either, Redacted } from "effect";
import { readEnvValue } from "@/services/repo-env";

/**
 * The **Stream Key** (GLOSSARY.md): YouTube's ingest key, kept only in the
 * repo-root `.env` as `YOUTUBE_STREAM_KEY`. It is read from that file itself
 * at Go Live (never from an inherited environment variable, which turbo's
 * strict env mode drops), held as `Redacted`, and only ever unwrapped into the
 * `start-stream` command. Never stored in the database, shown or logged.
 */
export const STREAM_KEY_SETTING = "YOUTUBE_STREAM_KEY";

/** Why Go Live is refused without it: the setting's name, never a value. */
export const STREAM_KEY_MISSING = `No Stream Key: add ${STREAM_KEY_SETTING} to the .env file at the repo root, then Go Live again.`;

/** Why Go Live is refused when the `.env` is there but can't be read: the read's error, never the file's contents. */
export const streamKeyUnreadable = (error: string) =>
  `The .env file at the repo root could not be read, so CVM can't find ${STREAM_KEY_SETTING} in it (${error}). Fix the file, then Go Live again.`;

/**
 * The Stream Key in the `.env` at `envPath` (`repoEnvPath()`: undefined when
 * there is none), or why Go Live can't have it: missing, or the file
 * unreadable.
 */
export const readStreamKey = (
  envPath: string | undefined
): Either.Either<Redacted.Redacted<string>, string> => {
  if (envPath === undefined) return Either.left(STREAM_KEY_MISSING);
  let value: string | undefined;
  try {
    value = readEnvValue(envPath, STREAM_KEY_SETTING)?.trim();
  } catch (e) {
    // The error names the path, never the file's contents.
    const message = e instanceof Error ? e.message : String(e);
    return Either.left(streamKeyUnreadable(message));
  }
  return value
    ? Either.right(Redacted.make(value))
    : Either.left(STREAM_KEY_MISSING);
};
