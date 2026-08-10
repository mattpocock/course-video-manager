/**
 * Branded identifier types for rows that have been persisted.
 *
 * These live beside the schema rather than in the Video Editor because the
 * schema itself is typed in terms of them, and the schema is the one module
 * both the local application and the deployed API share. The editor's
 * `FrontendId` — an id for a Clip that exists only in the browser — is its
 * counterpart and stays there.
 */
export type Brand<T, B extends string> = T & { __brand: B };

/** The id of a row that exists in the database. */
export type DatabaseId = Brand<string, "DatabaseId">;
