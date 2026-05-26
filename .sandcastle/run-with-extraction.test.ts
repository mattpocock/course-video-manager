import { describe, it, expect, vi, beforeEach } from "vitest";
import { run, StructuredOutputError, Output } from "@ai-hero/sandcastle";
import { z } from "zod";
import { runWithExtraction } from "./run-with-extraction";

vi.mock("@ai-hero/sandcastle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-hero/sandcastle")>();
  return { ...actual, run: vi.fn() };
});

const mockRun = vi.mocked(run);

const schema = z.object({ value: z.string() });
const output = Output.object({ tag: "output", schema });

function baseOptions() {
  return {
    name: "test-run",
    agent: {} as never,
    sandbox: {} as never,
    promptFile: "/repo/prompt.md",
    output,
    extractionPrompt: "Emit the <output> block.",
  };
}

function produceResult(sessionId: string = "sess-1") {
  return {
    iterations: [{ sessionId }],
    stdout: "produce stdout",
    commits: [{ sha: "abc123" }],
    branch: "feat/x",
  } as never;
}

function produceResultWithoutSession() {
  return {
    iterations: [{}],
    stdout: "produce stdout",
    commits: [{ sha: "abc123" }],
    branch: "feat/x",
  } as never;
}

function extractionResult(value: string) {
  return {
    iterations: [{ sessionId: "sess-extract" }],
    stdout: "extract stdout",
    commits: [],
    branch: "feat/x",
    output: { value },
  } as never;
}

function structuredError(
  rawMatched: string | undefined,
  cause: unknown = new Error("Unexpected end of JSON input"),
  sessionId: string = "sess-extract"
) {
  return new StructuredOutputError("extraction failed", {
    tag: "output",
    rawMatched,
    cause,
    commits: [],
    branch: "feat/x",
    sessionId,
  });
}

beforeEach(() => {
  mockRun.mockReset();
});

describe("runWithExtraction", () => {
  it("runs produce without output, then a resumed extraction pass", async () => {
    mockRun
      .mockResolvedValueOnce(produceResult())
      .mockResolvedValueOnce(extractionResult("ok"));

    const result = await runWithExtraction(baseOptions());

    expect(result.output).toEqual({ value: "ok" });
    // commits/branch come from the produce run, not the extraction run.
    expect(result.commits).toEqual([{ sha: "abc123" }]);
    expect(mockRun).toHaveBeenCalledTimes(2);

    const produceCall = mockRun.mock.calls[0]![0];
    expect(produceCall).not.toHaveProperty("output");
    expect(produceCall).not.toHaveProperty("resumeSession");

    const extractCall = mockRun.mock.calls[1]![0];
    expect(extractCall.resumeSession).toBe("sess-1");
    expect(extractCall.output).toBe(output);
    expect(extractCall.promptFile).toBeUndefined();
    expect(extractCall.prompt).toBe("Emit the <output> block.");
  });

  it("keeps promptArgs on the produce call but drops it from the inline extraction", async () => {
    mockRun
      .mockResolvedValueOnce(produceResult())
      .mockResolvedValueOnce(extractionResult("ok"));

    const promptArgs = { PR_NUMBER: "878" };
    await runWithExtraction({ ...baseOptions(), promptArgs });

    // The produce call uses promptFile, so promptArgs is valid there.
    const produceCall = mockRun.mock.calls[0]![0];
    expect(produceCall.promptArgs).toBe(promptArgs);
    expect(produceCall.promptFile).toBe("/repo/prompt.md");

    // The extraction call swaps to an inline prompt; Sandcastle rejects
    // promptArgs alongside an inline prompt, so it must be dropped.
    const extractCall = mockRun.mock.calls[1]![0];
    expect(extractCall.prompt).toBe("Emit the <output> block.");
    expect(extractCall.promptFile).toBeUndefined();
    expect(extractCall).not.toHaveProperty("promptArgs");
  });

  it("retries on StructuredOutputError, feeding back the bad output and cause", async () => {
    mockRun
      .mockResolvedValueOnce(produceResult())
      .mockRejectedValueOnce(
        structuredError('{"value":}', new Error("Unexpected token }"))
      )
      .mockResolvedValueOnce(extractionResult("recovered"));

    const result = await runWithExtraction(baseOptions());

    expect(result.output).toEqual({ value: "recovered" });
    expect(mockRun).toHaveBeenCalledTimes(3);

    // First extraction attempt resumes the produce session; the retry resumes
    // the *failed extraction's* own session (via error.sessionId) so the fix
    // happens in-context.
    expect(mockRun.mock.calls[1]![0].resumeSession).toBe("sess-1");
    expect(mockRun.mock.calls[2]![0].resumeSession).toBe("sess-extract");

    const retryPrompt = mockRun.mock.calls[2]![0].prompt as string;
    expect(retryPrompt).toContain("Previous attempt failed");
    expect(retryPrompt).toContain('{"value":}');
    expect(retryPrompt).toContain("Unexpected token }");
  });

  it("describes a missing tag distinctly from a validation failure", async () => {
    mockRun
      .mockResolvedValueOnce(produceResult())
      .mockRejectedValueOnce(structuredError(undefined))
      .mockResolvedValueOnce(extractionResult("ok"));

    await runWithExtraction(baseOptions());

    const retryPrompt = mockRun.mock.calls[2]![0].prompt as string;
    expect(retryPrompt).toContain("did not contain a `<output>` block");
  });

  it("rethrows the final StructuredOutputError after exhausting attempts", async () => {
    const finalError = structuredError('{"nope":1}');
    mockRun
      .mockResolvedValueOnce(produceResult())
      .mockRejectedValueOnce(structuredError('{"a":1}'))
      .mockRejectedValueOnce(structuredError('{"b":2}'))
      .mockRejectedValueOnce(finalError);

    await expect(runWithExtraction(baseOptions())).rejects.toBe(finalError);
    // 1 produce + 3 extraction attempts (default maxAttempts).
    expect(mockRun).toHaveBeenCalledTimes(4);
  });

  it("honours a custom maxAttempts", async () => {
    mockRun
      .mockResolvedValueOnce(produceResult())
      .mockRejectedValueOnce(structuredError('{"a":1}'))
      .mockRejectedValueOnce(structuredError('{"b":2}'));

    await expect(
      runWithExtraction({ ...baseOptions(), maxAttempts: 2 })
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(mockRun).toHaveBeenCalledTimes(3); // 1 produce + 2 extraction
  });

  it("does not retry on a non-StructuredOutputError", async () => {
    const boom = new Error("network down");
    mockRun.mockResolvedValueOnce(produceResult()).mockRejectedValueOnce(boom);

    await expect(runWithExtraction(baseOptions())).rejects.toBe(boom);
    expect(mockRun).toHaveBeenCalledTimes(2); // produce + 1 failed extraction, no retry
  });

  it("throws a clear error when the produce run yields no sessionId", async () => {
    mockRun.mockResolvedValueOnce(produceResultWithoutSession());

    await expect(runWithExtraction(baseOptions())).rejects.toThrow(
      /no sessionId/
    );
    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});
