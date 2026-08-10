import type {
  SearchHit,
  SearchKind,
  SearchRoot,
} from "@cvm/core/services/db-search-operations.server";

/**
 * The `search` verb group's request body.
 *
 * `types` is an array on the wire and a `ReadonlySet` in the service, which is
 * the only shape difference between the two sides of the call. Everything else
 * is the service's own parameter object.
 */
export interface SearchRequest {
  readonly root: SearchRoot;
  readonly query: string;
  readonly types: ReadonlyArray<SearchKind>;
}

/** The service answers `null` for a scoped root that is missing or archived. */
export type SearchResponse = ReadonlyArray<SearchHit> | null;

const KINDS: ReadonlyArray<SearchKind> = [
  "course",
  "section",
  "lesson",
  "video",
  "beat",
  "pitch",
];

const isKind = (value: unknown): value is SearchKind =>
  typeof value === "string" && KINDS.includes(value as SearchKind);

const parseRoot = (value: unknown): SearchRoot | undefined => {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  if (typeof id !== "string") return undefined;
  if (kind !== "course" && kind !== "section" && kind !== "lesson") {
    return undefined;
  }
  return { kind, id };
};

/**
 * Validate an untrusted request body.
 *
 * The CLI has already rejected an unknown `--type` with its own message and
 * exit code by the time it gets here, so this is not user-facing validation —
 * it is the guard that keeps a malformed body from reaching a query builder.
 */
export const parseSearchRequest = (body: unknown): SearchRequest | null => {
  if (typeof body !== "object" || body === null) return null;
  const { root, query, types } = body as Record<string, unknown>;

  if (typeof query !== "string") return null;
  if (!Array.isArray(types) || !types.every(isKind)) return null;

  const parsedRoot = parseRoot(root);
  if (parsedRoot === undefined) return null;

  return { root: parsedRoot, query, types: types as ReadonlyArray<SearchKind> };
};
