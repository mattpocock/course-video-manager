import { TransportError } from "@cvm/core/rpc/rpc-errors";
import { encodeRpcError, type RpcResponse } from "@cvm/core/rpc/wire";
import { Cause, Context, Effect, Exit } from "effect";
import type { Context as HonoContext } from "hono";
import type { DomainServices } from "@cvm/core/layer";
import type { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import type { RemoteRuntime } from "./runtime";

/**
 * Run one domain Effect and turn BOTH of its channels into the wire envelope.
 *
 * This is the whole of the Effect/HTTP boundary. A typed failure keeps its tag
 * and its fields; a defect becomes an `UnknownDBServiceError` with a fixed
 * message, because a defect on a deployed box is a stack trace and possibly a
 * SQL statement, and neither is the caller's business.
 */
export const runRpc = async <A, E>(
  runtime: RemoteRuntime,
  effect: Effect.Effect<A, E, DomainServices | DrizzleService>
): Promise<RpcResponse<A>> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value };

  const failure = Cause.failureOption(exit.cause);
  return {
    ok: false,
    error: encodeRpcError(failure._tag === "Some" ? failure.value : undefined),
  };
};

/** Anything on a service that answers with an Effect — i.e. a domain call. */
type ServiceMethod = (
  ...args: never[]
) => Effect.Effect<unknown, unknown, never>;

/** The names of `S`'s domain calls. Plain fields (`_tag`) are excluded. */
type MethodsOf<S> = {
  [K in keyof S]: S[K] extends ServiceMethod ? K : never;
}[keyof S];

/**
 * One endpoint: name a service and one of its methods, and the request body's
 * ARGUMENT ARRAY is spread into it.
 *
 * That is the whole route. It is written once and generically because both
 * sides of the call already derive their types from the SAME service interface
 * in `@cvm/core` — the client's method signatures are checked against it (see
 * `app/cli/rpc-layer.ts`), and here the arguments are simply passed along. A
 * route that re-declared the argument shape would be a third copy of a
 * signature TypeScript is already checking twice, and the copy that drifts.
 *
 * So adding a verb is one line here and one line in the CLI's layer. There is
 * no request-shape design discussion, which is the point: the API is the CLI's
 * transport, not a resource model.
 */
export const forward =
  <S extends DomainServices, K extends MethodsOf<S>>(
    runtime: RemoteRuntime,
    tag: Context.Tag<S, S>,
    method: K
  ) =>
  async (c: HonoContext) => {
    const args = await c.req.json().catch(() => null);

    // Not user-facing validation — the CLI is the only caller and it is typed.
    // This is the guard that keeps a body of the wrong SHAPE from reaching a
    // query builder as a spread argument list.
    if (!Array.isArray(args)) {
      const body: RpcResponse<never> = {
        ok: false,
        error: encodeRpcError(
          new TransportError({
            message: `${String(method)} expects a JSON array of arguments`,
          })
        ),
      };
      return c.json(body, 400);
    }

    const body: RpcResponse<unknown> = await runRpc(
      runtime,
      Effect.flatMap(tag, (service) =>
        (
          service[method] as (
            ...a: ReadonlyArray<unknown>
          ) => Effect.Effect<unknown, unknown, never>
        )(...args)
      )
    );
    return c.json(body);
  };
