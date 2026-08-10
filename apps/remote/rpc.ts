import { encodeRpcError, type RpcResponse } from "@cvm/core/rpc/wire";
import { Cause, Effect, Exit } from "effect";
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
