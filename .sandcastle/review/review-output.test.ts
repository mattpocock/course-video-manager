import { describe, it, expect } from "vitest";
import { ReviewOutput } from "./review-output";

describe("ReviewOutput", () => {
  it("parses canonical format", () => {
    const result = ReviewOutput.parse({
      summary: "Looks good.",
      inlineComments: [
        { path: "app/foo.ts", line: 42, body: "Nit: rename this." },
      ],
      replies: [{ commentId: "PRRC_abc", body: "Fixed." }],
    });
    expect(result.inlineComments[0]).toEqual({
      path: "app/foo.ts",
      line: 42,
      body: "Nit: rename this.",
    });
  });

  it("accepts file as alias for path", () => {
    const result = ReviewOutput.parse({
      summary: "OK",
      inlineComments: [{ file: "app/bar.ts", line: 10, body: "Check this." }],
    });
    expect(result.inlineComments[0]!.path).toBe("app/bar.ts");
  });

  it("accepts comment as alias for body", () => {
    const result = ReviewOutput.parse({
      summary: "OK",
      inlineComments: [
        { path: "app/bar.ts", line: 10, comment: "Check this." },
      ],
    });
    expect(result.inlineComments[0]!.body).toBe("Check this.");
  });

  it("accepts lineRange string and extracts first number", () => {
    const result = ReviewOutput.parse({
      summary: "OK",
      inlineComments: [
        { file: "app/foo.ts", lineRange: "5-108", comment: "Big range." },
      ],
    });
    expect(result.inlineComments[0]).toEqual({
      path: "app/foo.ts",
      line: 5,
      body: "Big range.",
    });
  });

  it("accepts lineRange as a single-number string", () => {
    const result = ReviewOutput.parse({
      summary: "OK",
      inlineComments: [
        { file: "app/foo.ts", lineRange: "122", comment: "Single line." },
      ],
    });
    expect(result.inlineComments[0]!.line).toBe(122);
  });

  it("strips unknown top-level fields like verdict", () => {
    const result = ReviewOutput.parse({
      verdict: "approve",
      summary: "Clean review.",
      inlineComments: [],
      replies: [],
    });
    expect(result.summary).toBe("Clean review.");
    expect((result as Record<string, unknown>)["verdict"]).toBeUndefined();
  });

  it("defaults inlineComments and replies to empty arrays when omitted", () => {
    const result = ReviewOutput.parse({ summary: "All good." });
    expect(result.inlineComments).toEqual([]);
    expect(result.replies).toEqual([]);
  });

  it("rejects inline comment with neither path nor file", () => {
    expect(() =>
      ReviewOutput.parse({
        summary: "OK",
        inlineComments: [{ line: 1, body: "Orphan comment." }],
      })
    ).toThrow();
  });

  it("rejects inline comment with neither body nor comment", () => {
    expect(() =>
      ReviewOutput.parse({
        summary: "OK",
        inlineComments: [{ path: "app/foo.ts", line: 1 }],
      })
    ).toThrow();
  });
});
