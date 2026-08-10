import journal from "../db/migrations/meta/_journal.json";

/**
 * The one number the two ends of the wire compare.
 *
 * `cvm` runs from a git checkout, on a box deployed separately from the API.
 * Nothing keeps the two in step by itself, so each states which schema it was
 * built against and the deployed app refuses a mismatch (see
 * `apps/remote/version.ts`).
 *
 * The value is the LENGTH OF THE DRIZZLE MIGRATION JOURNAL, taken from the
 * journal itself rather than kept alongside it. A number a human has to bump is
 * a number that is eventually not bumped, and the failure mode of a stale
 * version constant is an out-of-date CLI that the gate waves through — exactly
 * what the gate exists to stop.
 *
 * Only the length is read: comparing tags would refuse a CLI whose journal is
 * identical but for a rename, and the question being asked is only "has a
 * migration landed since this checkout was cut?".
 */
export const SCHEMA_VERSION: number = journal.entries.length;

/**
 * The header the CLI states its version in. Lowercase because Hono normalises
 * header names, and both ends read this constant rather than a literal.
 */
export const SCHEMA_VERSION_HEADER = "x-cvm-schema-version";

/**
 * The version a caller claims, read out of the header it stated it in.
 * `null` means it claimed nothing at all.
 *
 * DIGITS ONLY, deliberately. `Number` is far too willing: `Number("")` is 0,
 * `Number(" ")` is 0, `Number("0x5")` is 5 and `Number("1e2")` is 100 — so a
 * lenient parse turns a header a proxy blanked, or one written in a notation
 * nobody meant, into a CONFIDENT claim of a version that was never made. The
 * refusal then names a number the caller never said, which is the one thing a
 * message whose whole job is to be acted on must not do.
 *
 * Anything that is not a plain run of digits is therefore no claim at all, and
 * lands in the same branch as a missing header: refused, and told so in the
 * words for a caller that stated nothing.
 */
export const parseSchemaVersionHeader = (
  raw: string | undefined
): number | null => {
  if (raw === undefined) return null;
  const stated = raw.trim();
  if (!/^\d+$/.test(stated)) return null;
  return Number(stated);
};

/**
 * The message a mismatch answers with. It names BOTH numbers and the single
 * action that fixes it, because the caller is usually an agent on a box nobody
 * is watching: one that reads this pulls and carries on, where one that reads
 * "internal error" retries the same stale request forever.
 */
export const schemaVersionMismatchMessage = (
  cliVersion: number | null,
  apiVersion: number
): string =>
  `this cvm was built against ${cliVersion === null ? "an unstated schema version" : `schema version ${cliVersion}`} and the Course Video Manager API is on ${apiVersion} — pull the latest course-video-manager on this box, then run the command again. Retrying as-is will keep failing.`;
