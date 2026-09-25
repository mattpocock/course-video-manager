import { describe, expect, it } from "vitest";
import {
  CLIP_MOCKUP_TTS_MODEL,
  CLIP_MOCKUP_VOICE,
  chunkLine,
  pcmToWav,
  speechFilename,
  wavDurationSeconds,
} from "./clip-mockup-speech-service";

/**
 * The pure half of the speech service — everything that does NOT call Gemini.
 *
 * The service itself is never the thing under test (the CLI suites fake it),
 * but three pieces of arithmetic inside it decide what an author hears and how
 * long an Animatic claims to run, and none of them needs a network: the
 * chunker that keeps a long line from truncating mid-word, the WAV header the
 * duration is read back out of, and the content-addressed filename that is the
 * whole speech cache.
 */

describe("chunkLine", () => {
  it("leaves a normal Clip Mockup line as one chunk", () => {
    expect(chunkLine("Here's the problem. And here's the fix.", 800)).toEqual([
      "Here's the problem. And here's the fix.",
    ]);
  });

  it("splits over the budget, and never mid-sentence", () => {
    const sentence = `${"word ".repeat(9).trim()}.`; // 9 words + a full stop
    const chunks = chunkLine(Array(5).fill(sentence).join(" "), 20);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.endsWith(".")).toBe(true);
    }
  });

  it("keeps every word — a long line degrades rather than truncating", () => {
    const line = Array.from({ length: 30 }, (_, i) => `S${i} two three.`).join(
      " "
    );
    expect(chunkLine(line, 10).join(" ").split(/\s+/)).toHaveLength(
      line.split(/\s+/).length
    );
  });

  it("gives a single over-budget sentence its own chunk rather than dropping it", () => {
    const monster = `${"word ".repeat(50).trim()}.`;
    expect(chunkLine(monster, 10)).toEqual([monster]);
  });

  it("never returns nothing", () => {
    expect(chunkLine("", 800)).toEqual([""]);
  });
});

/**
 * The header a BROWSER reads, field by field.
 *
 * `wavDurationSeconds` only ever touched byteRate and dataSize, so a header
 * with `bitsPerSample` left at zero measured correctly, cached correctly and
 * reported its length correctly — and played as silence in the Animatic,
 * because a browser decoder refuses a format chunk that does not say how wide
 * a sample is. Every field the decoder reads is asserted here, not just the
 * two the duration needs.
 */
describe("pcmToWav", () => {
  it("writes a format chunk a decoder will accept", () => {
    const wav = pcmToWav(new Uint8Array(24000 * 2), 24000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.subarray(12, 16).toString()).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24000); // sample rate
    expect(view.getUint32(28, true)).toBe(48000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(wav.subarray(36, 40).toString()).toBe("data");
    expect(view.getUint32(40, true)).toBe(24000 * 2);
  });

  it("agrees with itself: byte rate is block align times sample rate", () => {
    const wav = pcmToWav(new Uint8Array(8), 48000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const blockAlign = view.getUint16(32, true);
    const bitsPerSample = view.getUint16(34, true);
    const channels = view.getUint16(22, true);

    expect(blockAlign).toBe((channels * bitsPerSample) / 8);
    expect(view.getUint32(28, true)).toBe(
      view.getUint32(24, true) * blockAlign
    );
  });
});

describe("wavDurationSeconds", () => {
  it("reads a run time back out of a WAV this service wrote", () => {
    // One second of s16le mono at 24kHz.
    const wav = pcmToWav(new Uint8Array(24000 * 2), 24000);
    expect(wavDurationSeconds(wav)).toBeCloseTo(1, 6);
  });

  it("measures fractions, never whole seconds", () => {
    const wav = pcmToWav(new Uint8Array(Math.round(24000 * 1.5) * 2), 24000);
    expect(wavDurationSeconds(wav)).toBeCloseTo(1.5, 6);
  });

  it("counts anything it cannot read as a cache MISS rather than a duration", () => {
    expect(wavDurationSeconds(new Uint8Array(10))).toBeUndefined();
    expect(wavDurationSeconds(new Uint8Array(200))).toBeUndefined();
    expect(
      wavDurationSeconds(pcmToWav(new Uint8Array(0), 24000))
    ).toBeUndefined();
  });
});

describe("speechFilename", () => {
  it("is the same file for the same words", () => {
    expect(speechFilename("Here's the problem.")).toBe(
      speechFilename("Here's the problem.")
    );
  });

  it("is a different file for different words", () => {
    expect(speechFilename("One.")).not.toBe(speechFilename("Two."));
  });

  it("names the voice and the model, so a stale WAV is impossible", () => {
    // Guard: if either constant is ever changed, every cached WAV must miss.
    expect(CLIP_MOCKUP_VOICE).toBe("Leda");
    expect(CLIP_MOCKUP_TTS_MODEL).toBe("gemini-2.5-flash-tts");
    expect(speechFilename("A line.")).toMatch(/^speech-[0-9a-f]{32}\.wav$/);
  });
});
