import { describe, it, expect } from "vitest";
import {
  createConnectionLog,
  CHURN_THRESHOLD,
  WINDOW_MS,
} from "./connection-log";

const EDITOR = "http://localhost:5173";
const PROMPTER = "http://localhost:5174";

describe("connection log", () => {
  it("prints a first connect in full, with the origin and the client count", () => {
    const log = createConnectionLog(() => 0);
    expect(log.onConnect({ origin: EDITOR, clientCount: 1 })).toBe(
      `Client connected — 1 client(s) — ${EDITOR}`
    );
  });

  it("names an origin-less connect rather than printing an empty one", () => {
    const log = createConnectionLog(() => 0);
    expect(log.onConnect({ origin: undefined, clientCount: 1 })).toContain(
      "unknown origin"
    );
  });

  it("prints each origin on its first connect", () => {
    const log = createConnectionLog(() => 0);
    expect(log.onConnect({ origin: EDITOR, clientCount: 1 })).toContain(EDITOR);
    expect(log.onConnect({ origin: PROMPTER, clientCount: 2 })).toContain(
      PROMPTER
    );
  });

  it("collapses a churning origin into one summary per window", () => {
    // The bug this guards: the editor reopened its hub socket every ~2s for as
    // long as OBS was shut, and every connect printed an identical line.
    let now = 0;
    const log = createConnectionLog(() => now);
    const lines: string[] = [];

    for (let i = 0; i < 5; i++) {
      const line = log.onConnect({ origin: EDITOR, clientCount: 2 });
      if (line) lines.push(line);
      now += 2000;
    }

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`Client connected — 2 client(s) — ${EDITOR}`);
    expect(lines[1]).toContain("churning its hub socket");
    expect(lines[1]).toContain(`${CHURN_THRESHOLD}x`);
  });

  it("does not call two connects in a window churn", () => {
    let now = 0;
    const log = createConnectionLog(() => now);
    log.onConnect({ origin: EDITOR, clientCount: 1 });
    now += 100;
    expect(log.onConnect({ origin: EDITOR, clientCount: 2 })).toBeNull();
  });

  it("prints in full again once the window has passed", () => {
    let now = 0;
    const log = createConnectionLog(() => now);
    log.onConnect({ origin: EDITOR, clientCount: 1 });
    now += WINDOW_MS + 1;
    expect(log.onConnect({ origin: EDITOR, clientCount: 1 })).toBe(
      `Client connected — 1 client(s) — ${EDITOR}`
    );
  });

  it("collapsing one origin does not silence another", () => {
    let now = 0;
    const log = createConnectionLog(() => now);
    for (let i = 0; i < 4; i++) {
      log.onConnect({ origin: EDITOR, clientCount: 1 });
      now += 500;
    }
    expect(log.onConnect({ origin: PROMPTER, clientCount: 2 })).toContain(
      PROMPTER
    );
  });
});
