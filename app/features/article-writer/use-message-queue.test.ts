import { describe, it, expect } from "vitest";
import { processSubmit, drainQueue } from "./use-message-queue";

describe("processSubmit", () => {
  it("sends immediately when status is ready", () => {
    const result = processSubmit("ready", "hello", []);
    expect(result.sent).toBe("hello");
    expect(result.queued).toEqual([]);
  });

  it("sends immediately when status is error", () => {
    const result = processSubmit("error", "retry this", []);
    expect(result.sent).toBe("retry this");
    expect(result.queued).toEqual([]);
  });

  it("queues when status is streaming", () => {
    const result = processSubmit("streaming", "queued msg", []);
    expect(result.sent).toBeNull();
    expect(result.queued).toEqual(["queued msg"]);
  });

  it("queues when status is submitted", () => {
    const result = processSubmit("submitted", "queued msg", []);
    expect(result.sent).toBeNull();
    expect(result.queued).toEqual(["queued msg"]);
  });

  it("appends to existing queue", () => {
    const result = processSubmit("streaming", "second", ["first"]);
    expect(result.sent).toBeNull();
    expect(result.queued).toEqual(["first", "second"]);
  });

  it("does not mutate the original queue array", () => {
    const original = ["first"];
    processSubmit("streaming", "second", original);
    expect(original).toEqual(["first"]);
  });
});

describe("drainQueue", () => {
  it("drains the first message when status is ready and queue is non-empty", () => {
    const result = drainQueue("ready", ["first", "second"]);
    expect(result.messageToSend).toBe("first");
    expect(result.nextQueue).toEqual(["second"]);
  });

  it("returns null when queue is empty", () => {
    const result = drainQueue("ready", []);
    expect(result.messageToSend).toBeNull();
    expect(result.nextQueue).toEqual([]);
  });

  it("does not drain when status is streaming", () => {
    const result = drainQueue("streaming", ["pending"]);
    expect(result.messageToSend).toBeNull();
    expect(result.nextQueue).toEqual(["pending"]);
  });

  it("does not drain when status is submitted", () => {
    const result = drainQueue("submitted", ["pending"]);
    expect(result.messageToSend).toBeNull();
    expect(result.nextQueue).toEqual(["pending"]);
  });

  it("does not drain when status is error", () => {
    const result = drainQueue("error", ["pending"]);
    expect(result.messageToSend).toBeNull();
    expect(result.nextQueue).toEqual(["pending"]);
  });

  it("drains only one message at a time", () => {
    const result = drainQueue("ready", ["a", "b", "c"]);
    expect(result.messageToSend).toBe("a");
    expect(result.nextQueue).toEqual(["b", "c"]);
  });

  it("does not mutate the original queue array", () => {
    const original = ["first", "second"];
    drainQueue("ready", original);
    expect(original).toEqual(["first", "second"]);
  });
});

describe("full queue lifecycle", () => {
  it("queues messages during streaming, then drains one by one on ready", () => {
    // User submits while streaming
    let { queued } = processSubmit("streaming", "msg-1", []);
    expect(queued).toEqual(["msg-1"]);

    // User submits another while still streaming
    ({ queued } = processSubmit("streaming", "msg-2", queued));
    expect(queued).toEqual(["msg-1", "msg-2"]);

    // Stream completes → drain first message
    let drain = drainQueue("ready", queued);
    expect(drain.messageToSend).toBe("msg-1");
    queued = drain.nextQueue;

    // That send triggers streaming again → no drain
    drain = drainQueue("streaming", queued);
    expect(drain.messageToSend).toBeNull();

    // Second stream completes → drain second message
    drain = drainQueue("ready", queued);
    expect(drain.messageToSend).toBe("msg-2");
    expect(drain.nextQueue).toEqual([]);
  });
});
