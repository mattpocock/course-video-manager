import { Option, Redacted } from "effect";
import { readEnvValue, repoEnvPath } from "@/services/repo-env";

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

/** The Stream Key in the `.env` at `envPath` (default: the repo root's), if set. */
export const readStreamKey = (
  envPath: string | undefined = repoEnvPath()
): Option.Option<Redacted.Redacted<string>> => {
  if (envPath === undefined) return Option.none();
  let value: string | undefined;
  try {
    value = readEnvValue(envPath, STREAM_KEY_SETTING)?.trim();
  } catch {
    // An unreadable .env holds no key Go Live can use: refused as missing.
    return Option.none();
  }
  return value ? Option.some(Redacted.make(value)) : Option.none();
};
