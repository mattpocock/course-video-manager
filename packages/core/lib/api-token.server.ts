import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { API_TOKEN_ID_PREFIX } from "./api-token-constants";

/**
 * The shape of an API token, and nothing else — no database, no Effect.
 *
 * `node:crypto` makes this module server-only, hence the `.server` name. A
 * browser bundle cannot resolve that import, so anything a route component
 * needs — the id prefix, the default expiry — lives in `api-token-constants.ts`
 * and is only re-exported here for callers that already run on the server.
 *
 * A token is `cvm_<id>_<32 random bytes, base64url>`. The `cvm_<id>` head is
 * PUBLIC: it is the primary key of the row, so a presented token is resolved
 * with a single lookup on an indexed column. The tail is the secret.
 *
 * What is stored is the SHA-256 of the WHOLE token — not bcrypt or argon2. The
 * secret already carries 256 bits of entropy, so a slow key-derivation function
 * would add latency on every request and no security: there is nothing to brute
 * force. The lookup is by public id and the comparison is constant-time, so no
 * query ever scans on a user-supplied hash.
 */

export {
  API_TOKEN_DEFAULT_EXPIRY_DAYS,
  API_TOKEN_ID_PREFIX,
} from "./api-token-constants";

export interface GeneratedApiToken {
  /** The public prefix, e.g. `cvm_a1b2c3d4`. Stored as the row's primary key. */
  readonly id: string;
  /** The full token. Shown to the author exactly once, then never again. */
  readonly secret: string;
  /** SHA-256 of `secret`, hex. This is what the row stores. */
  readonly tokenHash: string;
}

/** `cvm_` + 8 hex chars — enough to be unique, short enough to read in a list. */
const ID_BYTES = 4;
/** 32 bytes is 256 bits of entropy, which is the whole security argument. */
const SECRET_BYTES = 32;

const ID_PATTERN = new RegExp(
  `^${API_TOKEN_ID_PREFIX}[0-9a-f]{${ID_BYTES * 2}}$`
);

/** SHA-256 of a token, hex-encoded. */
export const hashApiToken = (secret: string): string =>
  createHash("sha256").update(secret, "utf8").digest("hex");

/** Mint a brand new token. The caller stores `tokenHash` and shows `secret` once. */
export const generateApiToken = (): GeneratedApiToken => {
  const id = API_TOKEN_ID_PREFIX + randomBytes(ID_BYTES).toString("hex");
  const secret = `${id}_${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return { id, secret, tokenHash: hashApiToken(secret) };
};

/**
 * Split a presented token into the public id to look up and the hash to
 * compare. Returns `null` for anything that is not shaped like one of ours, so
 * a malformed `Authorization` header costs no database round trip.
 */
export const parseApiToken = (
  raw: string
): { readonly id: string; readonly tokenHash: string } | null => {
  const separator = raw.indexOf("_", API_TOKEN_ID_PREFIX.length);
  if (separator === -1) return null;

  const id = raw.slice(0, separator);
  const random = raw.slice(separator + 1);
  if (random.length === 0) return null;
  if (!ID_PATTERN.test(id)) return null;

  return { id, tokenHash: hashApiToken(raw) };
};

/**
 * Constant-time hash comparison. Length mismatch answers `false` rather than
 * throwing, because the candidate hash is derived from user input.
 */
export const tokenHashesMatch = (
  stored: string,
  candidate: string
): boolean => {
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(candidate, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};
