import { SchemaVersionMismatchError } from "@cvm/core/rpc/rpc-errors";
import {
  parseSchemaVersionHeader,
  SCHEMA_VERSION,
  SCHEMA_VERSION_HEADER,
  schemaVersionMismatchMessage,
} from "@cvm/core/rpc/schema-version";
import { encodeRpcError, type RpcResponse } from "@cvm/core/rpc/wire";
import type { MiddlewareHandler } from "hono";

/**
 * The version gate for every RPC route.
 *
 * The caller is a `cvm` running from a git checkout on a box deployed
 * separately from this app, so the two drift by themselves. Every request
 * states the schema version it was built against and ANY difference is refused
 * outright — before the request reaches a service, so a stale CLI cannot half-
 * write a Course on its way to discovering it is stale.
 *
 * Refused outright rather than tolerated within a range, because the tolerance
 * that matters is on the OTHER side of this line: migrations are additive-only
 * (no dropped or renamed column without a two-step release), which is what
 * keeps a CLI already mid-flight during a deploy from breaking. This gate is
 * about the NEXT command that box runs, and for that "you are out of date, pull"
 * is both true and actionable.
 *
 * A missing or unreadable header is a mismatch too. The alternative — waving
 * through a caller that stated nothing — makes the gate optional for exactly
 * the callers most likely to be old.
 */
export const requireSchemaVersion =
  (): MiddlewareHandler => async (c, next) => {
    const cliVersion = parseSchemaVersionHeader(
      c.req.header(SCHEMA_VERSION_HEADER)
    );

    if (cliVersion === SCHEMA_VERSION) return next();

    const body: RpcResponse<never> = {
      ok: false,
      error: encodeRpcError(
        new SchemaVersionMismatchError({
          message: schemaVersionMismatchMessage(cliVersion, SCHEMA_VERSION),
          cliVersion,
          apiVersion: SCHEMA_VERSION,
        })
      ),
    };
    // 409: the request is well-formed and the credentials are fine — it is the
    // caller's state that conflicts with the server's.
    return c.json(body, 409);
  };
