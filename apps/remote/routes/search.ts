import { SearchOperationsService } from "@cvm/core/services/db-search-operations.server";
import type {
  SearchKind,
  SearchRoot,
} from "@cvm/core/services/db-search-operations.server";
import { TransportError } from "@cvm/core/rpc/rpc-errors";
import { encodeRpcError, type RpcResponse } from "@cvm/core/rpc/wire";
import { Effect } from "effect";
import { Hono } from "hono";
import { runRpc } from "../rpc.js";
import type { RemoteRuntime } from "../runtime.js";

/**
 * The `search` verb group: `cvm search`, and the scoped
 * `cvm course|section|lesson search`.
 *
 * THE ONE HAND-WRITTEN ROUTE. Every other verb goes through `forward`, which
 * spreads the request body's argument array straight into the service method —
 * but `search` takes a `ReadonlySet` of kinds, and a Set is not JSON. So the
 * set travels as an array and this route is where it becomes a Set again. If
 * another verb ever grows a parameter JSON cannot carry, it joins this file;
 * until then this is the exception that shows why the rule holds elsewhere.
 */

/** The `search` verb group's single argument, as JSON can carry it. */
export interface SearchRequest {
  readonly root: SearchRoot;
  readonly query: string;
  readonly types: ReadonlyArray<SearchKind>;
}

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
  if (!Array.isArray(body)) return null;
  const params: unknown = body[0];
  if (typeof params !== "object" || params === null) return null;
  const { root, query, types } = params as Record<string, unknown>;

  if (typeof query !== "string") return null;
  if (!Array.isArray(types) || !types.every(isKind)) return null;

  const parsedRoot = parseRoot(root);
  if (parsedRoot === undefined) return null;

  return { root: parsedRoot, query, types: types as ReadonlyArray<SearchKind> };
};

export const searchRoutes = (runtime: RemoteRuntime) =>
  new Hono().post("/search", async (c) => {
    const request = parseSearchRequest(await c.req.json().catch(() => null));
    if (request === null) {
      const body: RpcResponse<never> = {
        ok: false,
        error: encodeRpcError(
          new TransportError({ message: "malformed search request" })
        ),
      };
      return c.json(body, 400);
    }

    const body: RpcResponse<unknown> = await runRpc(
      runtime,
      Effect.flatMap(SearchOperationsService, (svc) =>
        svc.search({
          root: request.root,
          query: request.query,
          types: new Set(request.types),
        })
      )
    );
    return c.json(body);
  });
