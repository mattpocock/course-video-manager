import { describe, expect, it } from "vitest";
import {
  resolveDatabaseUrl,
  resolveMigrationDatabaseUrl,
} from "./database-url";

const POOLED = "postgresql://user:pw@pooler.host/db";
const DIRECT = "postgresql://user:pw@direct.host/db";

describe("resolveDatabaseUrl", () => {
  it("is the pooled connection string", () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: POOLED, DIRECT_DATABASE_URL: DIRECT })
    ).toBe(POOLED);
  });

  it("is undefined when DATABASE_URL is unset", () => {
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});

describe("resolveMigrationDatabaseUrl", () => {
  it("prefers the direct connection string over the pooled one", () => {
    expect(
      resolveMigrationDatabaseUrl({
        DATABASE_URL: POOLED,
        DIRECT_DATABASE_URL: DIRECT,
      })
    ).toBe(DIRECT);
  });

  it("falls back to DATABASE_URL when no direct string is configured", () => {
    expect(resolveMigrationDatabaseUrl({ DATABASE_URL: POOLED })).toBe(POOLED);
  });

  it("ignores an empty direct connection string", () => {
    expect(
      resolveMigrationDatabaseUrl({
        DATABASE_URL: POOLED,
        DIRECT_DATABASE_URL: "",
      })
    ).toBe(POOLED);
  });

  it("is undefined when neither is set", () => {
    expect(resolveMigrationDatabaseUrl({})).toBeUndefined();
  });
});
