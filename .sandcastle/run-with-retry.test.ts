import { describe, it, expect, vi, beforeEach } from "vitest";
import { run, StructuredOutputError, Output } from "@ai-hero/sandcastle";
import { z } from "zod";
import { runWithRetry } from "./run-with-retry";

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
  };
}

function successResult(value: string) {
  return {
    iterations: [{ sessionId: "sess-1" }],
    stdout: "stdout",
    commits: [{ sha: "abc123" }],
    branch: "feat/x",
    output: { value },
  } as never;
}

function structuredError(
  rawMatched: string | undefined,
  opts: { sessionId?: string; cause?: unknown } = {}
) {
  // Use `in` so an explicit `{ sessionId: undefined }` is honoured rather than
  // falling back to the default (a default would swallow the undefined case).
  const sessionId = "sessionId" in opts ? opts.sessionId : "sess-1";
  const cause = opts.cause ?? new Error("Unexpected end of JSON input");
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

describe("runWithRetry", () => {
  it("returns on the first call when extraction succeeds", async () => {
    mockRun.mockResolvedValueOnce(successResult("ok"));

    const result = await runWithRetry(baseOptions());

    expect(result.output).toEqual({ value: "ok" });
    expect(mockRun).toHaveBeenCalledTimes(1);

    // First call carries output, runs the original prompt, no resume.
    const firstCall = mockRun.mock.calls[0]![0];
    expect(firstCall.output).toBe(output);
    expect(firstCall.promptFile).toBe("/repo/prompt.md");
    expect(firstCall).not.toHaveProperty("resumeSession");
  });

  it("resumes the failed session with feedback on StructuredOutputError", async () => {
    mockRun
      .mockRejectedValueOnce(
        structuredError('{"value":}', {
          cause: new Error("Unexpected token }"),
        })
      )
      .mockResolvedValueOnce(successResult("recovered"));

    const result = await runWithRetry(baseOptions());

    expect(result.output).toEqual({ value: "recovered" });
    expect(mockRun).toHaveBeenCalledTimes(2);

    const retryCall = mockRun.mock.calls[1]![0];
    // The retry resumes the *failed call's own* session, via error.sessionId.
    expect(retryCall.resumeSession).toBe("sess-1");
    expect(retryCall.output).toBe(output);
    expect(retryCall.promptFile).toBeUndefined();

    const retryPrompt = retryCall.prompt as string;
    expect(retryPrompt).toContain("Previous attempt failed");
    expect(retryPrompt).toContain('{"value":}');
    expect(retryPrompt).toContain("Unexpected token }");
  });

  it("keeps promptArgs on the first call but drops it from the inline retry", async () => {
    mockRun
      .mockRejectedValueOnce(structuredError('{"value":}'))
      .mockResolvedValueOnce(successResult("recovered"));

    const promptArgs = { PR_NUMBER: "878" };
    await runWithRetry({ ...baseOptions(), promptArgs });

    // First call uses promptFile, so promptArgs is valid there.
    const firstCall = mockRun.mock.calls[0]![0];
    expect(firstCall.promptArgs).toBe(promptArgs);
    expect(firstCall.promptFile).toBe("/repo/prompt.md");

    // The retry swaps to an inline feedback prompt; Sandcastle rejects
    // promptArgs alongside an inline prompt, so it must be dropped.
    const retryCall = mockRun.mock.calls[1]![0];
    expect(retryCall.promptFile).toBeUndefined();
    expect(retryCall).not.toHaveProperty("promptArgs");
  });

  it("describes a missing tag distinctly from a validation failure", async () => {
    mockRun
      .mockRejectedValueOnce(structuredError(undefined))
      .mockResolvedValueOnce(successResult("ok"));

    await runWithRetry(baseOptions());

    const retryPrompt = mockRun.mock.calls[1]![0].prompt as string;
    expect(retryPrompt).toContain("did not contain a `<output>` block");
  });

  it("rethrows the final StructuredOutputError after exhausting attempts", async () => {
    const finalError = structuredError('{"c":3}');
    mockRun
      .mockRejectedValueOnce(structuredError('{"a":1}'))
      .mockRejectedValueOnce(structuredError('{"b":2}'))
      .mockRejectedValueOnce(finalError);

    await expect(runWithRetry(baseOptions())).rejects.toBe(finalError);
    // Default maxAttempts = 3 total calls (initial + 2 retries).
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  it("honours a custom maxAttempts", async () => {
    mockRun
      .mockRejectedValueOnce(structuredError('{"a":1}'))
      .mockRejectedValueOnce(structuredError('{"b":2}'));

    await expect(
      runWithRetry({ ...baseOptions(), maxAttempts: 2 })
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a non-StructuredOutputError", async () => {
    const boom = new Error("network down");
    mockRun.mockRejectedValueOnce(boom);

    await expect(runWithRetry(baseOptions())).rejects.toBe(boom);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when the failed run carried no sessionId", async () => {
    mockRun.mockRejectedValueOnce(
      structuredError('{"a":1}', { sessionId: undefined })
    );

    await expect(runWithRetry(baseOptions())).rejects.toThrow(/no sessionId/);
    // Initial call only — we can't resume without a sessionId.
    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});
