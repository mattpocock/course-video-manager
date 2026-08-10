import { SearchOperationsService } from "@cvm/core/services/db-search-operations.server";
import { encodeRpcError, type RpcResponse } from "@cvm/core/rpc/wire";
import { TransportError } from "@cvm/core/rpc/rpc-errors";
import { Effect } from "effect";
import { Hono } from "hono";
import { authenticate } from "./auth";
import { parseSearchRequest, type SearchResponse } from "./routes/search";
import { runRpc } from "./rpc";
import { remoteRuntime, type RemoteRuntime } from "./runtime";

/**
 * The deployed RPC API.
 *
 * ONE ENDPOINT PER CLI VERB, grouped by domain noun. There is deliberately no
 * resource modelling here: the API's job is to be the CLI's transport, so
 * adding a command is one endpoint and no design discussion.
 *
 * The routes are CHAINED rather than registered one statement at a time,
 * because the chain is what carries the route types out through
 * `RemoteApp` — the CLI's client is derived from that type, so a client/server
 * mismatch is a compile error rather than a 404 on a box nobody is watching.
 *
 * `createApp` takes the runtime as an argument so the CLI test harness can hand
 * it a PGlite-backed one and call `app.fetch` with no server and no port.
 */
export const createApp = (runtime: RemoteRuntime) =>
  new Hono()
    // Unauthenticated on purpose: it answers nothing about the domain, and a
    // weekly ping is what stops Vercel archiving the function.
    .get("/health", (c) => c.json({ ok: true as const }))
    .use("/rpc/*", authenticate(runtime))
    .post("/rpc/search/search", async (c) => {
      const request = parseSearchRequest(await c.req.json().catch(() => null));
      if (request === null) {
        const body: RpcResponse<SearchResponse> = {
          ok: false,
          error: encodeRpcError(
            new TransportError({ message: "malformed search request" })
          ),
        };
        return c.json(body, 400);
      }

      const body: RpcResponse<SearchResponse> = await runRpc(
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

/**
 * The app type the CLI's client is built from. The CLI imports THIS AND ONLY
 * THIS from `@cvm/remote` — a `import type`, so no server code is ever bundled
 * into what runs on the remote box.
 */
export type RemoteApp = ReturnType<typeof createApp>;

/** The production app, on the production runtime. */
export const app = createApp(remoteRuntime);
