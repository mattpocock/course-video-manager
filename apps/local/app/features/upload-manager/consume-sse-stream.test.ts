import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeSSEStream } from "./consume-sse-stream";

const encoder = new TextEncoder();

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  body?: ReadableStream<Uint8Array> | null;
}) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    body: response.body ?? null,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function waitForStreamEnd(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consumeSSEStream", () => {
  it("dispatches a normal multi-event sequence", async () => {
    const stream = createMockStream([
      sseEvent("stage", { stage: "rendering" }),
      sseEvent("stage", { stage: "encoding" }),
      sseEvent("complete", {}),
    ]);
    mockFetch({ ok: true, body: stream });

    const onStage = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: { stage: onStage, complete: onComplete },
      onError,
    });

    await waitForStreamEnd();

    expect(onStage).toHaveBeenCalledTimes(2);
    expect(onStage).toHaveBeenNthCalledWith(1, { stage: "rendering" });
    expect(onStage).toHaveBeenNthCalledWith(2, { stage: "encoding" });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({});
    expect(onError).not.toHaveBeenCalled();
  });

  it("handles chunk boundary splitting an event across two reads", async () => {
    const fullEvent = sseEvent("stage", { stage: "rendering" });
    const splitPoint = Math.floor(fullEvent.length / 2);
    const stream = createMockStream([
      fullEvent.slice(0, splitPoint),
      fullEvent.slice(splitPoint) + sseEvent("complete", {}),
    ]);
    mockFetch({ ok: true, body: stream });

    const onStage = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: { stage: onStage, complete: onComplete },
      onError,
    });

    await waitForStreamEnd();

    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage).toHaveBeenCalledWith({ stage: "rendering" });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("handles multiple events packed in a single chunk", async () => {
    const stream = createMockStream([
      sseEvent("stage", { stage: "rendering" }) +
        sseEvent("stage", { stage: "encoding" }) +
        sseEvent("complete", { result: "ok" }),
    ]);
    mockFetch({ ok: true, body: stream });

    const onStage = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: { stage: onStage, complete: onComplete },
      onError,
    });

    await waitForStreamEnd();

    expect(onStage).toHaveBeenCalledTimes(2);
    expect(onStage).toHaveBeenNthCalledWith(1, { stage: "rendering" });
    expect(onStage).toHaveBeenNthCalledWith(2, { stage: "encoding" });
    expect(onComplete).toHaveBeenCalledWith({ result: "ok" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("handles abort mid-stream", async () => {
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount++;
        if (pullCount === 1) {
          controller.enqueue(
            encoder.encode(sseEvent("stage", { stage: "rendering" }))
          );
        }
        // Never close — simulates a long-running stream
      },
    });
    mockFetch({ ok: true, body: stream });

    const onStage = vi.fn();
    const onError = vi.fn();

    const controller = consumeSSEStream({
      url: "/api/test",
      body: {},
      events: { stage: onStage },
      onError,
      errorLabel: "Test failed",
    });

    await waitForStreamEnd();
    expect(onStage).toHaveBeenCalledTimes(1);

    controller.abort();
    await waitForStreamEnd();

    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError for non-200 response", async () => {
    mockFetch({ ok: false, status: 500, body: null });

    const onStage = vi.fn();
    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: { stage: onStage },
      onError,
      errorLabel: "Export failed",
    });

    await waitForStreamEnd();

    expect(onError).toHaveBeenCalledWith("Export failed");
    expect(onStage).not.toHaveBeenCalled();
  });

  it("calls onError for response with no body", async () => {
    mockFetch({ ok: true, body: null });

    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: {},
      onError,
      errorLabel: "No body",
    });

    await waitForStreamEnd();

    expect(onError).toHaveBeenCalledWith("No body");
  });

  it("calls onError for malformed JSON in data field", async () => {
    const stream = createMockStream([
      "event: stage\ndata: {not valid json}\n\n",
    ]);
    mockFetch({ ok: true, body: stream });

    const onStage = vi.fn();
    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: { stage: onStage },
      onError,
      errorLabel: "Parse failed",
    });

    await waitForStreamEnd();

    expect(onStage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it("silently ignores unknown event types", async () => {
    const stream = createMockStream([
      sseEvent("unknown-event", { foo: "bar" }),
      sseEvent("stage", { stage: "rendering" }),
    ]);
    mockFetch({ ok: true, body: stream });

    const onStage = vi.fn();
    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: { stage: onStage },
      onError,
    });

    await waitForStreamEnd();

    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage).toHaveBeenCalledWith({ stage: "rendering" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("passes correct fetch options", async () => {
    const stream = createMockStream([]);
    const fetchMock = mockFetch({ ok: true, body: stream });

    consumeSSEStream({
      url: "/api/videos/123/export-sse",
      method: "POST",
      body: { key: "value" },
      events: {},
      onError: vi.fn(),
    });

    await waitForStreamEnd();

    expect(fetchMock).toHaveBeenCalledWith("/api/videos/123/export-sse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("uses default error label when errorLabel is not provided", async () => {
    mockFetch({ ok: false, status: 500, body: null });

    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: {},
      onError,
    });

    await waitForStreamEnd();

    expect(onError).toHaveBeenCalledWith("Stream failed");
  });

  it("uses error.message for non-AbortError exceptions", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network failure"));
    vi.stubGlobal("fetch", fetchMock);

    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: {},
      onError,
    });

    await waitForStreamEnd();

    expect(onError).toHaveBeenCalledWith("Network failure");
  });

  it("handles chunk splitting the event: line from the data: line", async () => {
    const stream = createMockStream([
      "event: stage\n",
      "data: " + JSON.stringify({ stage: "rendering" }) + "\n\n",
    ]);
    mockFetch({ ok: true, body: stream });

    const onStage = vi.fn();
    const onError = vi.fn();

    consumeSSEStream({
      url: "/api/test",
      body: {},
      events: { stage: onStage },
      onError,
    });

    await waitForStreamEnd();

    expect(onStage).toHaveBeenCalledWith({ stage: "rendering" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns an AbortController", () => {
    const stream = createMockStream([]);
    mockFetch({ ok: true, body: stream });

    const result = consumeSSEStream({
      url: "/api/test",
      events: {},
      onError: vi.fn(),
    });

    expect(result).toBeInstanceOf(AbortController);
  });
});
