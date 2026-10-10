import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { ensureWhisperEnv, envKey } from "./local-whisper-env";

describe("ensureWhisperEnv", () => {
  it("names the fix when python3 is missing, and builds nothing", async () => {
    const path = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      const result = await Effect.runPromise(Effect.either(ensureWhisperEnv));
      expect(Either.isLeft(result)).toBe(true);
      const message = Either.isLeft(result) ? result.left.message : "";
      expect(message).toContain("needs python3");
      expect(message).toContain("sudo apt install python3 python3-venv");
      expect(message).toContain("restart the Sidecar");
    } finally {
      process.env.PATH = path;
    }
  });
});

describe("envKey", () => {
  it("changes with the lock and with the Python, and only with them", () => {
    const key = envKey("faster-whisper==1.2.1", "Python 3.12.3");
    expect(envKey("faster-whisper==1.2.1", "Python 3.12.3")).toBe(key);
    expect(envKey("faster-whisper==1.2.2", "Python 3.12.3")).not.toBe(key);
    expect(envKey("faster-whisper==1.2.1", "Python 3.13.0")).not.toBe(key);
  });
});
