import { ApiTokenOperationsService } from "@cvm/core/services/db-api-token-operations.server";
import {
  AUTHENTICATION_FAILED_MESSAGE,
  AuthenticationError,
} from "@cvm/core/rpc/rpc-errors";
import { encodeRpcError } from "@cvm/core/rpc/wire";
import { Effect, Exit } from "effect";
import type { MiddlewareHandler } from "hono";
import type { RemoteRuntime } from "./runtime";

/**
 * Bearer authentication for every RPC route.
 *
 * ONE answer for every way a token can be no good — missing header, wrong
 * scheme, malformed token, unknown id, forged secret, expired, revoked. The
 * status, the headers and the body are byte-identical in all of them, so the
 * endpoint cannot be used to work out which tokens exist. The deployed app is
 * the only place that knows the difference, and it keeps it.
 *
 * A DATABASE failure is the one thing that is NOT folded in. It says nothing
 * about any token, and an agent told "your credentials are bad" when the
 * database is down goes and fetches a new token for no reason. That answers
 * 500, which the CLI reads as a transport failure — retry later, same token.
 */
export const authenticate =
  (runtime: RemoteRuntime): MiddlewareHandler =>
  async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const [scheme, ...rest] = header.split(" ");
    const presented = rest.join(" ").trim();

    const rejected = () =>
      c.json(
        {
          ok: false as const,
          error: encodeRpcError(
            new AuthenticationError({ message: AUTHENTICATION_FAILED_MESSAGE })
          ),
        },
        401,
        { "WWW-Authenticate": "Bearer" }
      );

    if (scheme?.toLowerCase() !== "bearer" || presented.length === 0) {
      return rejected();
    }

    const exit = await runtime.runPromiseExit(
      Effect.flatMap(ApiTokenOperationsService, (tokens) =>
        tokens.authenticate(presented)
      )
    );

    if (Exit.isFailure(exit)) {
      return c.json(
        { ok: false as const, error: encodeRpcError(undefined) },
        500
      );
    }
    if (exit.value === null) return rejected();

    return next();
  };
