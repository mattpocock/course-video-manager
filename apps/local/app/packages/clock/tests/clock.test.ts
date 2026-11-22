import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { after, delay, every, now, nowMs, toDate } from "@/packages/clock";

const NOON = 1_767_268_800_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the current time", () => {
  it("reads the system clock", () => {
    expect(nowMs()).toBe(NOON);
    expect(now().toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("turns an ISO string or epoch ms into a date", () => {
    expect(toDate("2026-01-01T12:00:00.000Z").getTime()).toBe(NOON);
    expect(toDate(NOON).toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });
});

describe("timers", () => {
  it("delay resolves once its time has passed", async () => {
    let done = false;
    void delay(100).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("after runs once, and not at all once cancelled", () => {
    const ran: string[] = [];
    after(50, () => ran.push("kept"));
    const cancel = after(50, () => ran.push("cancelled"));
    cancel();
    vi.advanceTimersByTime(200);
    expect(ran).toEqual(["kept"]);
  });

  it("every repeats until cancelled", () => {
    let ticks = 0;
    const cancel = every(10, () => {
      ticks++;
    });
    vi.advanceTimersByTime(35);
    cancel();
    vi.advanceTimersByTime(100);
    expect(ticks).toBe(3);
  });
});
