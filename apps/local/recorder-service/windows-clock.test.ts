import { afterEach, describe, expect, it, vi } from "vitest";
import { type ClockTicker, startWindowsClock } from "./windows-clock";

/**
 * The Windows clock with its PowerShell loop faked: each fake tick source
 * prints the ticks the test gives it and ends when the test says so.
 */

type FakeTicker = ClockTicker & {
  tick(ms: number): void;
  end(reason: string): void;
};

const fakeTicker = (): FakeTicker => {
  const data: ((c: string) => void)[] = [];
  const ends: ((r: string) => void)[] = [];
  return {
    onData: (l) => void data.push(l),
    onEnd: (l) => void ends.push(l),
    kill: () => {},
    tick: (ms) => data.forEach((l) => l(`${ms}\r\n`)),
    end: (reason) => ends.forEach((l) => l(reason)),
  };
};

const startFakeClock = async () => {
  const tickers: FakeTicker[] = [];
  const spawnTicker = () => {
    const t = fakeTicker();
    tickers.push(t);
    // The first tick source ticks as soon as it starts.
    if (tickers.length === 1) setImmediate(() => t.tick(1_000));
    return t;
  };
  const clock = await startWindowsClock({
    spawnTicker,
    staleAfterMs: 1000,
    respawnAfterMs: 500,
  });
  return { clock, tickers };
};

describe("startWindowsClock", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refuses to tell the time once its tick source has gone quiet, and recovers when a respawned one ticks", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["performance", "setTimeout"] });
    const { clock, tickers } = await startFakeClock();
    expect(clock.now()).toBe(1_000);

    tickers[0]!.end("exited with 1");
    vi.advanceTimersByTime(1_200);
    expect(() => clock.now()).toThrow(/Windows clock has not ticked/);

    expect(tickers).toHaveLength(2);
    tickers[1]!.tick(5_000);
    vi.advanceTimersByTime(10);
    expect(clock.now()).toBe(5_010);
    clock.stop();
  });

  it("fails start-up if the tick source ends before its first tick", async () => {
    await expect(
      startWindowsClock({
        spawnTicker: () => {
          const t = fakeTicker();
          setImmediate(() => t.end("exited with 1"));
          return t;
        },
      })
    ).rejects.toThrow(/Windows clock \(PowerShell\) exited with 1/);
  });
});
