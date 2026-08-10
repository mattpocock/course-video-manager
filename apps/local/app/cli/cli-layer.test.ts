import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchOperationsService } from "@/services/db-search-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { cliLayer } from "./layer";

// ===========================================================================
// The CLI's own layer, on a machine that has only a token.
//
// The rest of the cli-* suites provide their own layer, so this is the one
// place `cliLayer` itself is exercised. What it proves is the whole point of
// the transport: `cvm` reaches the domain data with NO connection string
// anywhere near the box.
// ===========================================================================

const ENV_KEYS = ["DATABASE_URL", "CVM_API_URL", "CVM_API_TOKEN"] as const;
const previous: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) previous[key] = process.env[key];
  delete process.env.DATABASE_URL;
  process.env.CVM_API_URL = "http://cvm-api.test";
  process.env.CVM_API_TOKEN = "cvm_deadbeef_not-used-no-request-is-made";
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("with a token and no DATABASE_URL", () => {
  it("builds, and hands out the services that live behind the API", async () => {
    const search = await Effect.runPromise(
      Effect.provide(SearchOperationsService, cliLayer)
    );

    expect(typeof search.search).toBe("function");
  });

  it("still builds the verb groups that are wired in-process", async () => {
    // They construct fine — a database is only needed to ANSWER, and each one
    // reports that for itself. Dying while the layer was built would have taken
    // `cvm search` down alongside them.
    const courses = await Effect.runPromise(
      Effect.provide(CourseOperationsService, cliLayer)
    );

    expect(typeof courses.getCourses).toBe("function");
  });

  it("fails an in-process verb with a cause that names the missing DATABASE_URL", async () => {
    // The CLI still renders this as the usual DatabaseError / exit 4 — it
    // never leaks internals — but whoever reads the logs gets told the actual
    // reason instead of a connection refusal to nowhere.
    const courses = await Effect.runPromise(
      Effect.provide(CourseOperationsService, cliLayer)
    );

    const error = await Effect.runPromise(Effect.flip(courses.getCourses()));

    expect(error._tag).toBe("UnknownDBServiceError");
    expect(String(error.cause)).toContain("no DATABASE_URL");
  });
});
