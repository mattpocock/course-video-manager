import { describe, expect, it } from "vitest";
import {
  createSSEResponse,
  type SendEvent,
} from "./create-sse-response.server";
import { Effect, Layer, ManagedRuntime } from "effect";

const testRuntime = ManagedRuntime.make(Layer.empty);

async function readAllEvents(response: Response): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim()) events.push(part + "\n\n");
    }
  }
  return events;
}

describe("createSSEResponse", () => {
  it("returns correct SSE headers", () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.void,
    });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });

  it("formats events in correct SSE framing", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: (sendEvent) =>
        Effect.sync(() => {
          sendEvent("stage", { stage: "rendering" });
          sendEvent("complete", {});
        }),
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: stage\ndata: {"stage":"rendering"}\n\n',
      "event: complete\ndata: {}\n\n",
    ]);
  });

  it("closes the stream after program completes", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: (sendEvent) =>
        Effect.sync(() => {
          sendEvent("complete", {});
        }),
    });

    const reader = response.body!.getReader();
    const { done: firstDone } = await reader.read();
    expect(firstDone).toBe(false);

    const { done: secondDone } = await reader.read();
    expect(secondDone).toBe(true);
  });

  it("sends error event for tagged errors", async () => {
    class TestError {
      readonly _tag = "TestError";
      constructor(readonly detail: string) {}
    }

    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail(new TestError("something broke")),
      errorHandlers: [
        {
          tag: "TestError",
          handler: (e: TestError, sendEvent: SendEvent) => {
            sendEvent("error", { message: e.detail });
          },
        },
      ],
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: error\ndata: {"message":"something broke"}\n\n',
    ]);
  });

  it("sends fallback error event for untagged errors without message", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail({ code: 500 }),
      fallbackMessage: "Export failed unexpectedly",
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: error\ndata: {"message":"Export failed unexpectedly"}\n\n',
    ]);
  });

  it("uses error.message in fallback when available", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail({ message: "specific error text" }),
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: error\ndata: {"message":"specific error text"}\n\n',
    ]);
  });

  it("uses default fallback message when error has no message", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail({ code: 42 }),
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: error\ndata: {"message":"An unexpected error occurred"}\n\n',
    ]);
  });

  it("matches the first applicable tagged error handler", async () => {
    class FirstError {
      readonly _tag = "FirstError";
    }
    class SecondError {
      readonly _tag = "SecondError";
    }

    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail(new SecondError()),
      errorHandlers: [
        {
          tag: "FirstError",
          handler: (_e: FirstError, sendEvent: SendEvent) => {
            sendEvent("error", { message: "first" });
          },
        },
        {
          tag: "SecondError",
          handler: (_e: SecondError, sendEvent: SendEvent) => {
            sendEvent("error", { message: "second" });
          },
        },
      ],
    });

    const events = await readAllEvents(response);

    expect(events).toEqual(['event: error\ndata: {"message":"second"}\n\n']);
  });
});
