import type { RemoteApp } from "@cvm/remote/app";
import {
  AUTHENTICATION_FAILED_MESSAGE,
  AuthenticationError,
  TransportError,
} from "@cvm/core/rpc/rpc-errors";
import { decodeRpcError, isRpcFailure } from "@cvm/core/rpc/wire";
import { Effect } from "effect";
import { hc } from "hono/client";
import type { ClientResponse } from "hono/client";

/**
 * The CLI's client for the deployed API.
 *
 * It is DERIVED FROM THE APP'S TYPE — `hc<RemoteApp>` — so an endpoint that is
 * renamed, removed, or given a different request body is a compile error here
 * rather than a 404 on a box nobody is watching. `RemoteApp` is a `import type`
 * and the only thing this file takes from `@cvm/remote`: no server code is ever
 * bundled into what runs on the remote machine.
 */

export interface RpcClientConfig {
  /** Base URL of the deployed app, e.g. `https://cvm-api.vercel.app`. */
  readonly baseUrl: string;
  /** The bearer token, minted from the Course Video Manager UI. */
  readonly token: string;
  /**
   * Test seam. A Hono app is a `fetch` handler, so the CLI test harness passes
   * the app's own `fetch` here and the whole path — CLI, client, HTTP, bearer
   * auth, Effect service, database — runs with no server and no port.
   */
  readonly fetch?: typeof globalThis.fetch;
}

export type RpcClient = ReturnType<typeof hc<RemoteApp>>;

export const makeRpcClient = (config: RpcClientConfig): RpcClient =>
  hc<RemoteApp>(config.baseUrl, {
    ...(config.fetch ? { fetch: config.fetch } : {}),
    headers: { authorization: `Bearer ${config.token}` },
  });

/**
 * Turn one client call into an Effect, restoring the failure channel the
 * service had when it ran in-process.
 *
 * Three failure shapes, three tags, deliberately kept apart:
 *   - the API could not be reached / did not answer JSON -> TransportError
 *   - the API rejected the credentials (401)             -> AuthenticationError
 *   - the domain said no                                 -> its own tag, rebuilt
 *
 * That separation is the point: "your token expired" and "that Video does not
 * exist" need completely different actions, and an agent that confuses them
 * retries forever.
 */
export const callRpc = <A>(
  send: () => Promise<ClientResponse<unknown, number, "json">>
): Effect.Effect<A, AuthenticationError | TransportError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: send,
      catch: (cause) =>
        new TransportError({
          message: `could not reach the Course Video Manager API: ${String(cause)}`,
        }),
    });

    if (response.status === 401) {
      return yield* new AuthenticationError({
        message: AUTHENTICATION_FAILED_MESSAGE,
      });
    }

    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) =>
        new TransportError({
          message: `the Course Video Manager API answered with something unreadable: ${String(cause)}`,
        }),
    });

    if (isRpcFailure(body)) {
      // Rebuilt as the tagged error the service raised, so `_tag` assertions
      // and exit codes are identical to the in-process path.
      return yield* Effect.fail(decodeRpcError(body.error) as never);
    }

    if (
      typeof body !== "object" ||
      body === null ||
      (body as { ok?: unknown }).ok !== true
    ) {
      return yield* new TransportError({
        message: "the Course Video Manager API answered in an unknown shape",
      });
    }

    return (body as { value: A }).value;
  });
