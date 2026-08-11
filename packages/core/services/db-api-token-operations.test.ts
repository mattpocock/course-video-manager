import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { beforeAll, beforeEach, describe, expect } from "vitest";
import { DrizzleService } from "./drizzle-service.server.js";
import { ApiTokenOperationsService } from "./db-api-token-operations.server.js";
import { API_TOKEN_DEFAULT_EXPIRY_DAYS } from "../lib/api-token-constants.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

let testDb: TestDb;
let testLayer: Layer.Layer<ApiTokenOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = ApiTokenOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe("mint", () => {
  it.effect("returns the secret exactly once, and never again", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const minted = yield* svc.mint({ name: "agent box" });

      expect(minted.name).toBe("agent box");
      expect(minted.secret.startsWith(`${minted.id}_`)).toBe(true);

      const listed = yield* svc.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(minted.id);
      expect(listed[0]).not.toHaveProperty("secret");
      expect(listed[0]).not.toHaveProperty("tokenHash");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("defaults the expiry to 90 days out", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const before = Date.now();
      const minted = yield* svc.mint({ name: "agent box" });

      const expected = before + API_TOKEN_DEFAULT_EXPIRY_DAYS * DAY_MS;
      expect(Math.abs(minted.expiresAt.getTime() - expected)).toBeLessThan(
        60_000
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("honours an explicit expiry", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const expiresAt = new Date("2030-01-01T00:00:00Z");
      const minted = yield* svc.mint({ name: "short-lived", expiresAt });

      expect(minted.expiresAt).toEqual(expiresAt);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("authenticate", () => {
  it.effect("accepts a valid token and advances lastUsedAt", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const minted = yield* svc.mint({ name: "agent box" });

      const beforeUse = yield* svc.list();
      expect(beforeUse[0]!.lastUsedAt).toBeNull();

      const authenticated = yield* svc.authenticate(minted.secret);
      expect(authenticated).toEqual({ id: minted.id, name: "agent box" });

      const afterUse = yield* svc.list();
      expect(afterUse[0]!.lastUsedAt).not.toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects an unknown token", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      yield* svc.mint({ name: "agent box" });

      expect(yield* svc.authenticate("cvm_deadbeef_nope")).toBeNull();
      expect(yield* svc.authenticate("not-a-token")).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects a token whose secret does not match its public id", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const minted = yield* svc.mint({ name: "agent box" });

      const forged = `${minted.id}_${"x".repeat(43)}`;
      expect(yield* svc.authenticate(forged)).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects an expired token", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const minted = yield* svc.mint({
        name: "stale",
        expiresAt: new Date(Date.now() - DAY_MS),
      });

      expect(yield* svc.authenticate(minted.secret)).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects a revoked token", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const minted = yield* svc.mint({ name: "compromised" });

      yield* svc.revoke(minted.id);
      expect(yield* svc.authenticate(minted.secret)).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("leaves lastUsedAt alone when the token is rejected", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const minted = yield* svc.mint({ name: "compromised" });
      yield* svc.revoke(minted.id);

      yield* svc.authenticate(minted.secret);

      const listed = yield* svc.list();
      expect(listed[0]!.lastUsedAt).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );
});

describe("revoke", () => {
  it.effect("stamps revokedAt and keeps the token listed", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const minted = yield* svc.mint({ name: "agent box" });

      const revoked = yield* svc.revoke(minted.id);
      expect(revoked.revokedAt).not.toBeNull();

      const listed = yield* svc.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.revokedAt).not.toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for an unknown id", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const error = yield* Effect.flip(svc.revoke("cvm_deadbeef"));
      expect(error._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("is idempotent — revoking twice keeps the first timestamp", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const minted = yield* svc.mint({ name: "agent box" });

      const first = yield* svc.revoke(minted.id);
      const second = yield* svc.revoke(minted.id);
      expect(second.revokedAt).toEqual(first.revokedAt);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("list", () => {
  it.effect("orders newest first", () =>
    Effect.gen(function* () {
      const svc = yield* ApiTokenOperationsService;
      const older = yield* svc.mint({
        name: "older",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      });
      const newer = yield* svc.mint({
        name: "newer",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      });

      const listed = yield* svc.list();
      expect(listed.map((t) => t.id)).toEqual([newer.id, older.id]);
    }).pipe(Effect.provide(testLayer))
  );
});
