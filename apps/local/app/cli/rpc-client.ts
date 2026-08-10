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
 * A domain service's method, as it behaves once it is a network call away.
 *
 * Same arguments, same success value, same domain failures — plus the two the
 * wire adds. Building each RPC-backed method against this (`satisfies
 * RemoteService<T>` in ./rpc-layer.ts) is what makes a service signature
 * changing in `@cvm/core` a COMPILE ERROR in the CLI's client, rather than an
 * argument silently arriving as `undefined` on a box nobody is watching.
 */
type RemoteMethod<F> = F extends (
  ...args: infer A
) => Effect.Effect<infer R, infer E, infer _C>
  ? (...args: A) => Effect.Effect<R, E | AuthenticationError | TransportError>
  : F;

/**
 * The RPC-backed shape of a domain service. PARTIAL on purpose: the API
 * exposes what `cvm` asks for and nothing more, so a service's methods that no
 * command calls have no endpoint and belong in no client.
 */
export type RemoteService<S> = {
  readonly [K in keyof S]?: RemoteMethod<S[K]>;
};

/**
 * One RPC-backed service method: name the endpoint, and the method's OWN
 * arguments become the request body, in order, untouched.
 *
 * They are forwarded variadically rather than listed, so there is no place for
 * a client to reorder or drop an argument on its way to the wire — the only
 * thing a call site states is which endpoint it is. `F` comes from the
 * contextual type (`satisfies RemoteService<T>` at the call site), so the
 * method's signature is still the service's own.
 */
export const rpcMethod = <F>(
  send: (
    json: ReadonlyArray<unknown>
  ) => Promise<ClientResponse<unknown, number, "json">>
): F => ((...args: ReadonlyArray<unknown>) => callRpc(send, ...args)) as F;

/**
 * Trailing `undefined` arguments are DROPPED rather than serialised.
 *
 * `JSON.stringify([opts])` turns an omitted optional argument into `null`, and
 * a service that checks `opts?.format` behaves differently from one handed a
 * `null`. Dropping the tail is exactly what calling the method with fewer
 * arguments does, which is what the caller meant.
 */
const wireArgs = (args: ReadonlyArray<unknown>): ReadonlyArray<unknown> => {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end--;
  return args.slice(0, end);
};

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
  send: (
    json: ReadonlyArray<unknown>
  ) => Promise<ClientResponse<unknown, number, "json">>,
  ...args: ReadonlyArray<unknown>
): Effect.Effect<A, AuthenticationError | TransportError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => send(wireArgs(args)),
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
