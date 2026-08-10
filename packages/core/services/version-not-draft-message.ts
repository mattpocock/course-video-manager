/**
 * The user-facing message carried by VersionNotDraftError (issue #1403).
 *
 * Shared between the server (db-service-errors sets it as the error's
 * `message`, which route-action serializes as the 409 body) and the browser
 * (clients match on it to tell the terminal "version was published while you
 * were editing" 409 apart from other 409s, then surface it and force a reload
 * into the new Draft).
 */
export const VERSION_NOT_DRAFT_MESSAGE =
  "This version was published while you were editing — reload to continue in the new Draft.";

/**
 * Extract the human message from a 409 response body. route-action
 * serializes the error's `message` as a JSON string; a proxy or crash may
 * hand back plain text instead, so fall back to the raw body.
 */
export const parse409Message = (body: string): string => {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === "string") return parsed;
  } catch {
    // keep raw body
  }
  return body;
};
