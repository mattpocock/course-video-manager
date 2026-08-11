import { describe, expect, it } from "vitest";
import {
  parseSchemaVersionHeader,
  schemaVersionMismatchMessage,
} from "./schema-version.js";

// ===========================================================================
// What a caller is taken to have CLAIMED about its schema.
//
// The gate itself is exercised end to end from the CLI
// (apps/local/app/cli/cli-version-gate.test.ts) — exit code 6, both numbers,
// "pull". What that suite cannot reach is a header the CLI would never send:
// one a proxy blanked, or one carrying something that is not a number. Those
// arrive at the deployed app all the same, and the question here is what the
// refusal then TELLS the caller, because naming a version nobody claimed is
// the one way this message can mislead the agent acting on it.
// ===========================================================================

describe("a header stating a version", () => {
  it("reads it", () => {
    expect(parseSchemaVersionHeader("13")).toBe(13);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSchemaVersionHeader(" 13 ")).toBe(13);
  });
});

describe("a header stating nothing usable", () => {
  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["not a number", "abc"],
    ["hexadecimal", "0x5"],
    ["exponential", "1e2"],
    ["negative", "-1"],
    ["fractional", "1.5"],
  ])("is no claim at all when %s", (_, raw) => {
    expect(parseSchemaVersionHeader(raw)).toBeNull();
  });
});

describe("the refusal a caller reads", () => {
  it("says the version was unstated rather than naming a number nobody claimed", () => {
    // `Number("")` is 0, so a lenient parse would answer "built against schema
    // version 0" — a number the caller never said, sending an agent to look
    // for a checkout that does not exist.
    const message = schemaVersionMismatchMessage(
      parseSchemaVersionHeader(""),
      14
    );

    expect(message).toContain("unstated schema version");
    expect(message).not.toContain("version 0");
    expect(message).toContain("14");
    expect(message).toContain("pull");
  });

  it("names both numbers when the caller did state one", () => {
    const message = schemaVersionMismatchMessage(
      parseSchemaVersionHeader("13"),
      14
    );

    expect(message).toContain("schema version 13");
    expect(message).toContain("14");
  });
});
