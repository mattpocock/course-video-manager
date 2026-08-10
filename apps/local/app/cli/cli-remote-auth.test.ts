import { Effect } from "effect";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createApiTokenOperations,
  type ApiTokenOperationsService,
} from "@/services/db-api-token-operations.server";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildWriteLayer,
  makeRun,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// Bearer authentication, seen from where it matters: the CLI.
//
// The deployed API has no HTTP-level tests. Authentication, expiry and
// revocation all surface as an exit code and one line of stderr, which is the
// contract every other cli-* file already asserts on — so this file asserts on
// the same two things, through the same harness.
// ===========================================================================

let testDb: TestDb;
let tokens: ReturnType<typeof createApiTokenOperations>;

const runWithToken = (token: string) =>
  makeRun(buildWriteLayer(testDb, { token }));

/** The suite's default run(): a freshly minted, valid token. */
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

const mint = (params: Parameters<ApiTokenOperationsService["mint"]>[0]) =>
  Effect.runPromise(tokens.mint(params));

const list = () => Effect.runPromise(tokens.list());

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  tokens = createApiTokenOperations(testDb as never);
  run = makeRun(buildWriteLayer(testDb));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  await testDb.insert(schema.courses).values({ name: "Alpha", slug: "alpha" });
});

describe("a valid token", () => {
  it("reaches the domain data", async () => {
    const { stdout, stderr, exitCode } = await run(["search", "alpha"]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toMatchObject({
      kind: "course",
      name: "Alpha",
    });
  });

  it("advances lastUsedAt, so a token nobody needs is findable", async () => {
    const minted = await mint({ name: "agent box" });
    expect((await list())[0]!.lastUsedAt).toBeNull();

    const { exitCode } = await runWithToken(minted.secret)(["search", "alpha"]);

    expect(exitCode).toBe(0);
    expect((await list())[0]!.lastUsedAt).not.toBeNull();
  });
});

describe("a token the API will not accept", () => {
  const failureOf = (result: RunResult) => JSON.parse(result.stderr.trim());

  it("fails when the token is unknown", async () => {
    const result = await runWithToken("cvm_deadbeef_nope")(["search", "alpha"]);

    expect(result.exitCode).toBe(5);
    expect(failureOf(result)._tag).toBe("AuthenticationError");
    expect(result.stdout).toBe("");
  });

  it("fails when the token has expired", async () => {
    const minted = await mint({
      name: "stale",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await runWithToken(minted.secret)(["search", "alpha"]);

    expect(result.exitCode).toBe(5);
    expect(failureOf(result)._tag).toBe("AuthenticationError");
  });

  it("fails when the token has been revoked", async () => {
    const minted = await mint({ name: "compromised" });
    await Effect.runPromise(tokens.revoke(minted.id));

    const result = await runWithToken(minted.secret)(["search", "alpha"]);

    expect(result.exitCode).toBe(5);
    expect(failureOf(result)._tag).toBe("AuthenticationError");
  });

  it("says the same thing whichever it was", async () => {
    // The response must not be usable to probe for valid tokens, so unknown,
    // expired and revoked have to be indistinguishable from the outside.
    const expired = await mint({
      name: "stale",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const revoked = await mint({ name: "compromised" });
    await Effect.runPromise(tokens.revoke(revoked.id));

    const stderrs = await Promise.all(
      ["cvm_deadbeef_nope", expired.secret, revoked.secret].map(
        async (token) => (await runWithToken(token)(["search", "alpha"])).stderr
      )
    );

    expect(new Set(stderrs).size).toBe(1);
  });

  it("tells the agent what to do about it", async () => {
    const result = await runWithToken("cvm_deadbeef_nope")(["search", "alpha"]);

    expect(failureOf(result).message).toContain("CVM_API_TOKEN");
  });

  it("is distinguishable from a domain error", async () => {
    const [course] = await testDb.select().from(schema.courses);

    const authFailure = await runWithToken("cvm_deadbeef_nope")([
      "course",
      "search",
      course!.id,
      "alpha",
    ]);
    const domainFailure = await run([
      "course",
      "search",
      "course_does_not_exist",
      "alpha",
    ]);

    expect(failureOf(authFailure)._tag).toBe("AuthenticationError");
    expect(failureOf(domainFailure)._tag).toBe("NotFoundError");
    expect(authFailure.exitCode).not.toBe(domainFailure.exitCode);
  });

  it("leaves no trace on the token it rejected", async () => {
    const revoked = await mint({ name: "compromised" });
    await Effect.runPromise(tokens.revoke(revoked.id));

    await runWithToken(revoked.secret)(["search", "alpha"]);

    expect((await list())[0]!.lastUsedAt).toBeNull();
  });
});
