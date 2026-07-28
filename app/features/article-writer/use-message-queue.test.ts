import { describe, it, expect } from "vitest";
import { processSubmit, drainQueue } from "./use-message-queue";

describe("processSubmit", () => {
  it("sends immediately when status is ready", () => {
    const result = processSubmit("ready", "hello", [], false);
    expect(result.sent).toBe("hello");
    expect(result.queued).toEqual([]);
  });

  it("sends immediately when status is error", () => {
    const result = processSubmit("error", "retry this", [], false);
    expect(result.sent).toBe("retry this");
    expect(result.queued).toEqual([]);
  });

  it("queues when status is streaming", () => {
    const result = processSubmit("streaming", "queued msg", [], false);
    expect(result.sent).toBeNull();
    expect(result.queued).toEqual(["queued msg"]);
  });

  it("queues when status is submitted", () => {
    const result = processSubmit("submitted", "queued msg", [], false);
    expect(result.sent).toBeNull();
    expect(result.queued).toEqual(["queued msg"]);
  });

  it("appends to existing queue", () => {
    const result = processSubmit("streaming", "second", ["first"], false);
    expect(result.sent).toBeNull();
    expect(result.queued).toEqual(["first", "second"]);
  });

  it("does not mutate the original queue array", () => {
    const original = ["first"];
    processSubmit("streaming", "second", original, false);
    expect(original).toEqual(["first"]);
  });
});

describe("drainQueue", () => {
  it("drains the first message when status is ready and queue is non-empty", () => {
    const result = drainQueue("ready", ["first", "second"], false);
    expect(result.messageToSend).toBe("first");
    expect(result.nextQueue).toEqual(["second"]);
  });

  it("returns null when queue is empty", () => {
    const result = drainQueue("ready", [], false);
    expect(result.messageToSend).toBeNull();
    expect(result.nextQueue).toEqual([]);
  });

  it("does not drain when status is streaming", () => {
    const result = drainQueue("streaming", ["pending"], false);
    expect(result.messageToSend).toBeNull();
    expect(result.nextQueue).toEqual(["pending"]);
  });

  it("does not drain when status is submitted", () => {
    const result = drainQueue("submitted", ["pending"], false);
    expect(result.messageToSend).toBeNull();
    expect(result.nextQueue).toEqual(["pending"]);
  });

  it("does not drain when status is error", () => {
    const result = drainQueue("error", ["pending"], false);
    expect(result.messageToSend).toBeNull();
    expect(result.nextQueue).toEqual(["pending"]);
  });

  it("drains only one message at a time", () => {
    const result = drainQueue("ready", ["a", "b", "c"], false);
    expect(result.messageToSend).toBe("a");
    expect(result.nextQueue).toEqual(["b", "c"]);
  });

  it("does not mutate the original queue array", () => {
    const original = ["first", "second"];
    drainQueue("ready", original, false);
    expect(original).toEqual(["first", "second"]);
  });
});

describe("holding a send while a screenshot capture is in flight", () => {
  it("queues a message submitted while a capture is running", () => {
    const result = processSubmit("ready", "make it shorter", [], true);
    expect(result.sent).toBeNull();
    expect(result.queued).toEqual(["make it shorter"]);
  });

  it("does not drain while a capture is running", () => {
    const result = drainQueue("ready", ["make it shorter"], true);
    expect(result.messageToSend).toBeNull();
    expect(result.nextQueue).toEqual(["make it shorter"]);
  });

  it("does not hold a retry submitted while the last response errored", () => {
    // Nothing would ever release it: `drainQueue` only drains on "ready", and a
    // capture landing does not move an errored chat back to "ready".
    const result = processSubmit("error", "retry this", [], true);
    expect(result.sent).toBe("retry this");
    expect(result.queued).toEqual([]);
  });

  it("drains once the capture has landed", () => {
    // The capture rewrites the document; only then may the message go out, so
    // the request carries the captured image rather than the placeholder.
    const { queued } = processSubmit("ready", "make it shorter", [], true);
    const result = drainQueue("ready", queued, false);
    expect(result.messageToSend).toBe("make it shorter");
    expect(result.nextQueue).toEqual([]);
  });

  it("still holds a send made while a response is streaming", () => {
    // The capture flag narrows which statuses it can add a hold to; it must not
    // narrow the response-in-flight hold that was already there.
    const result = processSubmit("streaming", "queued msg", [], true);
    expect(result.sent).toBeNull();
    expect(result.queued).toEqual(["queued msg"]);
  });
});

describe("full queue lifecycle", () => {
  it("queues messages during streaming, then drains one by one on ready", () => {
    // User submits while streaming
    let { queued } = processSubmit("streaming", "msg-1", [], false);
    expect(queued).toEqual(["msg-1"]);

    // User submits another while still streaming
    ({ queued } = processSubmit("streaming", "msg-2", queued, false));
    expect(queued).toEqual(["msg-1", "msg-2"]);

    // Stream completes → drain first message
    let drain = drainQueue("ready", queued, false);
    expect(drain.messageToSend).toBe("msg-1");
    queued = drain.nextQueue;

    // That send triggers streaming again → no drain
    drain = drainQueue("streaming", queued, false);
    expect(drain.messageToSend).toBeNull();

    // Second stream completes → drain second message
    drain = drainQueue("ready", queued, false);
    expect(drain.messageToSend).toBe("msg-2");
    expect(drain.nextQueue).toEqual([]);
  });
});
