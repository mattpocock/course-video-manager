/**
 * The parts of an API Token's shape that a browser is allowed to know.
 *
 * The minting UI shows the default expiry in a form field, so the constant must
 * survive the client build. Everything else about a token — hashing, minting,
 * parsing — needs `node:crypto`, which a browser bundle cannot resolve, so it
 * lives in `api-token.server.ts` and stays out of every route module's import
 * graph.
 */

/** Every token id starts with this, so a leaked string is recognisable as ours. */
export const API_TOKEN_ID_PREFIX = "cvm_";

/** How long a freshly minted token lives unless the author says otherwise. */
export const API_TOKEN_DEFAULT_EXPIRY_DAYS = 90;
