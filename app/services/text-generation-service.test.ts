import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { isRetryableProviderError } from "./text-generation-service";

/**
 * Whether a refusal says "later" or "no" is the whole of the Autofill's retry
 * rule: a "later" backs off and does not consume the Video's one attempt, a
 * "no" does. Everything below is a real error object of the shape the AI SDK
 * actually throws — the classifier's only job is to read them correctly.
 */
const apiError = (statusCode: number) =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode,
  });

/**
 * The AI SDK exhausts its own backoff before giving up, and then throws this
 * rather than the provider's error. Every rate limit reaching us in production
 * is wrapped this way.
 */
const afterSdkRetries = (...attempts: unknown[]) =>
  new RetryError({
    message: `Failed after ${attempts.length} attempts`,
    reason: "maxRetriesExceeded",
    errors: attempts,
  });

describe("classifying a refusal from the model provider", () => {
  it("retries a rate limit the AI SDK has already given up on", () => {
    expect(
      isRetryableProviderError(afterSdkRetries(apiError(429), apiError(429)))
    ).toBe(true);
  });

  it("retries a server error the AI SDK has already given up on", () => {
    expect(isRetryableProviderError(afterSdkRetries(apiError(503)))).toBe(true);
  });

  it("retries a bare rate limit", () => {
    expect(isRetryableProviderError(apiError(429))).toBe(true);
  });

  it("does not retry a malformed request", () => {
    expect(isRetryableProviderError(apiError(400))).toBe(false);
  });

  it("does not retry a malformed request the SDK happened to wrap", () => {
    expect(isRetryableProviderError(afterSdkRetries(apiError(400)))).toBe(
      false
    );
  });

  it("does not retry a refusal that never reached the provider", () => {
    expect(isRetryableProviderError(new Error("boom"))).toBe(false);
  });

  it("does not retry a wrapper with nothing inside it", () => {
    expect(isRetryableProviderError(afterSdkRetries())).toBe(false);
  });
});
