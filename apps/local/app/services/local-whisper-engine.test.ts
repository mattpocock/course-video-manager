import { describe, expect, it } from "@effect/vitest";
import { Data, Effect } from "effect";
import {
  chooseTranscriber,
  LocalWhisperError,
  type AudioTranscript,
} from "./local-whisper-engine";

class NoEngine extends Data.TaggedError("NoEngine")<{ cause: unknown }> {}

const said = (text: string): AudioTranscript => ({
  segments: [{ start: 0, end: 1, text: ` ${text}` }],
  words: [{ start: 0, end: 1, text }],
});

const fakeOpenAI = () => {
  const calls: string[] = [];
  const transcribe = (audioPath: string) =>
    Effect.sync(() => {
      calls.push(audioPath);
      return said("openai");
    });
  return { calls, transcribe };
};

const local = (
  result: "ok" | "fails"
): Parameters<typeof chooseTranscriber>[0] => ({
  enabled: true,
  transcribe: () =>
    result === "ok"
      ? Effect.succeed(said("local"))
      : Effect.fail(new LocalWhisperError({ cause: null, message: "no GPU" })),
});

const disabled: Parameters<typeof chooseTranscriber>[0] = {
  enabled: false,
  transcribe: () =>
    Effect.fail(new LocalWhisperError({ cause: null, message: "off" })),
};

const noEngine = (cause: unknown) => new NoEngine({ cause });

describe("chooseTranscriber", () => {
  it.effect("uses OpenAI when Local Whisper is off", () =>
    Effect.gen(function* () {
      const openai = fakeOpenAI();
      const result = yield* chooseTranscriber(
        disabled,
        openai.transcribe,
        noEngine
      )("a.mp3");
      expect(result.words[0]?.text).toBe("openai");
      expect(openai.calls).toEqual(["a.mp3"]);
    })
  );

  it.effect("uses Local Whisper, not OpenAI, when it is on and works", () =>
    Effect.gen(function* () {
      const openai = fakeOpenAI();
      const result = yield* chooseTranscriber(
        local("ok"),
        openai.transcribe,
        noEngine
      )("a.mp3");
      expect(result.words[0]?.text).toBe("local");
      expect(openai.calls).toEqual([]);
    })
  );

  it.effect("falls back to OpenAI for a file Local Whisper fails on", () =>
    Effect.gen(function* () {
      const openai = fakeOpenAI();
      const result = yield* chooseTranscriber(
        local("fails"),
        openai.transcribe,
        noEngine
      )("a.mp3");
      expect(result.words[0]?.text).toBe("openai");
      expect(openai.calls).toEqual(["a.mp3"]);
    })
  );

  it.effect("fails when Local Whisper fails and there is no OpenAI key", () =>
    Effect.gen(function* () {
      const error = yield* chooseTranscriber(
        local("fails"),
        null,
        noEngine
      )("a.mp3").pipe(Effect.flip);
      expect(error._tag).toBe("NoEngine");
      expect(error.cause).toBeInstanceOf(LocalWhisperError);
    })
  );
});
