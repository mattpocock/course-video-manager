import { createApp } from "@cvm/remote/app";
import { domainServicesLayer } from "@cvm/core/layer";
import { generateApiToken } from "@cvm/core/lib/api-token";
import { SearchOperationsService } from "@/services/db-search-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import { Layer, ManagedRuntime } from "effect";
import type { TestDb } from "@/test-utils/pglite";
import { makeRemoteLayer } from "./rpc-layer";

/**
 * The transport, wired end to end, with no server and no port.
 *
 * A Hono app is just a `fetch` handler, so the deployed API can be CALLED
 * DIRECTLY from a test: point the CLI's HTTP client at `app.fetch` and every
 * `cvm` invocation in the suite runs the whole path — CLI parsing, the RPC
 * client, HTTP, bearer authentication, the Effect service, PGlite — while its
 * assertions stay exactly what they were when the service ran in-process.
 *
 * That is the point of this file. The CLI tests are the transport's test suite;
 * there are no separate HTTP-level tests, because authentication, expiry,
 * revocation and error mapping all surface as an exit code and a line of
 * stderr, which is what those tests already assert on.
 */

/** Any absolute URL will do — nothing ever leaves the process. */
export const TEST_API_BASE_URL = "http://cvm-api.test";

/**
 * The one token the suite authenticates with: minted once per worker, real
 * shape, real SHA-256. It stands for the token the author minted in the UI and
 * put on the box, and like that one it never changes.
 */
const HARNESS_TOKEN = generateApiToken();

/**
 * The deployed app, backed by this test's PGlite database.
 *
 * The token ROW is re-created before every request, not once per suite, because
 * `truncateAllTables` runs between tests and would otherwise delete the
 * credential the next test authenticates with. Layer construction stays free of
 * I/O, exactly as it is in production — a database too broken to answer must
 * fail through the CLI's own error path, not escape as a defect from a layer
 * that never finished building.
 */
const makeAppFetch = (
  db: TestDb,
  ensureHarnessToken: boolean
): typeof globalThis.fetch => {
  const runtime = ManagedRuntime.make(
    domainServicesLayer.pipe(
      Layer.provideMerge(Layer.succeed(DrizzleService, db as never))
    )
  );
  const app = createApp(runtime);

  return (async (input, init) => {
    if (ensureHarnessToken) {
      await db
        .insert(schema.apiTokens)
        .values({
          id: HARNESS_TOKEN.id,
          tokenHash: HARNESS_TOKEN.tokenHash,
          name: "cli test harness",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .onConflictDoNothing();
    }
    return app.fetch(new Request(input as string, init));
  }) as typeof globalThis.fetch;
};

export interface RemoteHarnessOptions {
  /**
   * Authenticate as this token instead of the harness's own. The auth tests
   * pass an unknown string, or the secret of a token they have expired or
   * revoked, to prove a bad credential surfaces as a CLI failure. Passing one
   * also stops the harness seeding its own token row, so a test that lists
   * tokens sees only the ones it minted.
   */
  readonly token?: string;
}

/** Build the CLI's HTTP-backed services against `db`. */
export const buildRemoteLayer = (
  db: TestDb,
  options: RemoteHarnessOptions = {}
): Layer.Layer<SearchOperationsService> =>
  makeRemoteLayer({
    baseUrl: TEST_API_BASE_URL,
    token: options.token ?? HARNESS_TOKEN.secret,
    fetch: makeAppFetch(db, options.token === undefined),
  });
