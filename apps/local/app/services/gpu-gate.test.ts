import { NodeContext } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Ref, TestContext } from "effect";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ClipMockupSpeechService,
  pcmToWav,
} from "./clip-mockup-speech-service";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { GpuGate, makeGpuGate, recorderGpuGateLayer } from "./gpu-gate";
import { LocalWhisperEngine } from "./local-whisper-engine";
import { resolveClipMockupSpeeches } from "./resolve-clip-mockup-speech";
import { SidecarContextTest } from "./sidecar-context";
import { STORAGE_ROOTS_ENV_KEY } from "./storage-roots";
import type { RecordingSignal } from "./still-gate";
import { WhisperTranscriptionService } from "./whisper-transcription-service";

/** A recorder the test starts and stops. */
const fakeRecorder = (recording = false) => {
  const listeners = new Set<(recording: boolean) => void>();
  const signal: RecordingSignal = {
    recording: () => recording,
    onRecordingChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const set = (now: boolean) => {
    recording = now;
    for (const l of listeners) l(now);
  };
  return { signal, set, listening: () => listeners.size };
};

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));

/** Lets every fiber that can move, move. */
const settle = Effect.yieldNow().pipe(Effect.repeatN(20));

describe("the GPU gate", () => {
  it("runs a Whisper pass at once while nothing records", async () => {
    const recorder = fakeRecorder(false);
    const gate = makeGpuGate(recorder.signal);
    expect(await run(gate(Effect.succeed("transcript")))).toBe("transcript");
    expect(recorder.listening()).toBe(0);
  });

  it("holds a pass asked for during a Recording Session (a Live Stream always records) until the Stop, then runs it", async () => {
    const recorder = fakeRecorder(true);
    const gate = makeGpuGate(recorder.signal);
    await run(
      Effect.gen(function* () {
        const passes = yield* Ref.make(0);
        const fiber = yield* Effect.fork(
          gate(Ref.updateAndGet(passes, (n) => n + 1))
        );
        yield* settle;
        expect(yield* Ref.get(passes)).toBe(0);

        recorder.set(false);
        expect(yield* Fiber.join(fiber)).toBe(1);
        expect(recorder.listening()).toBe(0);
      })
    );
  });

  it("lets the pass under way finish when Record is pressed, and holds the job's next chunk until the Stop", async () => {
    const recorder = fakeRecorder(false);
    const gate = makeGpuGate(recorder.signal);
    await run(
      Effect.gen(function* () {
        const heard = yield* Ref.make<string[]>([]);
        const firstChunkOnGpu = yield* Deferred.make<void>();
        const finishFirstChunk = yield* Deferred.make<void>();
        const chunk = (n: number) =>
          gate(
            Effect.gen(function* () {
              if (n === 1) {
                yield* Deferred.succeed(firstChunkOnGpu, undefined);
                yield* Deferred.await(finishFirstChunk);
              }
              yield* Ref.update(heard, (h) => [...h, `chunk ${n}`]);
            })
          );
        // A Footage transcription: its chunks one after another.
        const job = yield* Effect.fork(
          Effect.forEach([1, 2, 3], chunk, { discard: true })
        );
        yield* Deferred.await(firstChunkOnGpu);

        recorder.set(true);
        yield* Deferred.succeed(finishFirstChunk, undefined);
        yield* settle;
        expect(yield* Ref.get(heard)).toEqual(["chunk 1"]);

        recorder.set(false);
        yield* Fiber.join(job);
        expect(yield* Ref.get(heard)).toEqual([
          "chunk 1",
          "chunk 2",
          "chunk 3",
        ]);
      })
    );
  });

  it("passes a pass's failure on", async () => {
    const gate = makeGpuGate(fakeRecorder(false).signal);
    await expect(run(gate(Effect.fail("no GPU")))).rejects.toThrow("no GPU");
  });
});

/** A temp directory for one test, removed after it. */
const withTempDir = async <A>(
  prefix: string,
  body: (dir: string) => Promise<A>
) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe("the GPU gate holds every GPU user, not only Whisper (#2644)", () => {
  it(
    "holds an NVENC encode (an export, a Short, a render-vertical Job's) asked for during a Recording Session until the Stop, then runs it",
    () =>
      withTempDir("gpu-gate-encode-", async (dir) => {
        // A stand-in `ffmpeg` that notes each run: no real encode, no GPU.
        fs.writeFileSync(
          path.join(dir, "ffmpeg"),
          `#!/bin/sh\necho run >> "${dir}/runs.txt"\nexit 0\n`,
          { mode: 0o755 }
        );
        const runs = () =>
          fs.existsSync(path.join(dir, "runs.txt"))
            ? fs
                .readFileSync(path.join(dir, "runs.txt"), "utf8")
                .trim()
                .split("\n").length
            : 0;
        const originalPath = process.env.PATH;
        process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`;
        const recorder = fakeRecorder(true);
        try {
          await Effect.runPromise(
            Effect.gen(function* () {
              const ffmpeg = yield* FFmpegEncodeService;
              const encode = yield* Effect.fork(
                ffmpeg.compositeOverlay(
                  "in.mp4",
                  "subs.mov",
                  path.join(dir, "short.mp4"),
                  () => {}
                )
              );
              yield* Effect.sleep("300 millis");
              expect(runs()).toBe(0);

              recorder.set(false);
              yield* Fiber.join(encode);
              expect(runs()).toBe(1);
            }).pipe(
              Effect.provide(
                FFmpegEncodeService.Default.pipe(
                  Layer.provideMerge(
                    Layer.mergeAll(
                      NodeContext.layer,
                      SidecarContextTest,
                      Layer.succeed(GpuGate, {
                        run: makeGpuGate(recorder.signal),
                      })
                    )
                  )
                )
              )
            )
          );
        } finally {
          process.env.PATH = originalPath;
        }
      }),
    10_000
  );

  it("holds Kokoro: a Clip Mockup voice batch voices no line while recording, and yields between lines when Record is pressed", () =>
    withTempDir("gpu-gate-kokoro-", async (store) => {
      const original = process.env[STORAGE_ROOTS_ENV_KEY];
      process.env[STORAGE_ROOTS_ENV_KEY] = store;
      const recorder = fakeRecorder(false);
      const spoken: string[] = [];
      const wav = pcmToWav(Buffer.alloc(4800), 24000);
      // Kokoro, faked at its seam: Record is pressed while it voices "one".
      const speech = Layer.succeed(ClipMockupSpeechService, {
        synthesizeLine: (line: string) =>
          Effect.sync(() => {
            spoken.push(line);
            if (line === "one") recorder.set(true);
            return { wav, durationSeconds: 0.1 };
          }),
      } as unknown as ClipMockupSpeechService);
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const batch = yield* Effect.fork(
              resolveClipMockupSpeeches([
                { lineageId: "lineage-1", line: "one" },
                { lineageId: "lineage-1", line: "two" },
              ])
            );
            yield* Effect.sleep("100 millis");
            expect(spoken).toEqual(["one"]);

            recorder.set(false);
            const { files } = yield* Fiber.join(batch);
            expect(spoken).toEqual(["one", "two"]);
            expect(files).toHaveLength(2);
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                speech,
                NodeContext.layer,
                Layer.succeed(GpuGate, { run: makeGpuGate(recorder.signal) })
              )
            )
          )
        );
      } finally {
        if (original === undefined) delete process.env[STORAGE_ROOTS_ENV_KEY];
        else process.env[STORAGE_ROOTS_ENV_KEY] = original;
      }
    }));
});

// Matt's process needs each Clip's text as it arrives, in a Recording
// Session and in a Live Stream (2026-11-04): #2631 had held every Whisper
// pass until the Stop. A Clip's pass is short (its span of the mic file,
// from a warm model), so only a Footage file's chunks wait.
describe("Whisper transcription at the GPU gate", () => {
  it(
    "transcribes a Clip mid-Recording Session (a Live Stream always records), and holds a Footage file until the Stop",
    () =>
      withTempDir("gpu-gate-whisper-", async (dir) => {
        // A stand-in `ffmpeg` that writes an empty file where it is told: no real decode.
        fs.writeFileSync(
          path.join(dir, "ffmpeg"),
          `#!/bin/sh\nfor a; do last="$a"; done\n: > "$last"\nexit 0\n`,
          { mode: 0o755 }
        );
        const originalPath = process.env.PATH;
        process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`;
        const recorder = fakeRecorder(true);
        const heard: string[] = [];
        // Local Whisper, faked at its seam.
        const whisper = Layer.succeed(LocalWhisperEngine, {
          keepWarm: () => Effect.void,
          transcribe: () =>
            Effect.sync(() => {
              heard.push("pass");
              return {
                segments: [{ start: 0, end: 1, text: " hello" }],
                words: [{ start: 0, end: 1, text: "hello" }],
              };
            }),
        });
        try {
          await Effect.runPromise(
            Effect.gen(function* () {
              const whisperService = yield* WhisperTranscriptionService;
              const [clip] = yield* whisperService.transcribeClips([
                {
                  id: "clip-1",
                  inputVideo: path.join(dir, "mic.wav"),
                  startTime: 1,
                  duration: 2,
                },
              ]);
              expect(clip?.words.map((w) => w.text)).toEqual(["hello"]);

              const footage = yield* Effect.fork(
                whisperService.transcribeFootageFile(
                  path.join(dir, "footage.mp4")
                )
              );
              yield* Effect.sleep("300 millis");
              expect(heard).toEqual(["pass"]);

              recorder.set(false);
              yield* Fiber.join(footage);
              expect(heard).toEqual(["pass", "pass"]);
            }).pipe(
              Effect.provide(
                WhisperTranscriptionService.Default.pipe(
                  Layer.provideMerge(
                    Layer.mergeAll(
                      whisper,
                      NodeContext.layer,
                      SidecarContextTest,
                      Layer.succeed(GpuGate, {
                        run: makeGpuGate(recorder.signal),
                      })
                    )
                  )
                )
              )
            )
          );
        } finally {
          process.env.PATH = originalPath;
        }
      }),
    10_000
  );
});

// The Sidecar's gate reads the recorder service's `/health`, as `cvm`'s
// Still Gate does: a fake service on its own port, never Matt's.
describe("the Sidecar's GPU gate, on the recorder service's /health", () => {
  const recorder = { recording: false };
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          service: "recorder",
          pid: 1,
          state: recorder.recording ? { kind: "recording" } : { kind: "open" },
          takesClosing: false,
        })
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("hears a Record pressed long after the Sidecar started, and holds the next pass until the Stop", async () => {
    recorder.recording = false;
    const order: string[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* GpuGate;
        yield* gate.run(Effect.sync(() => order.push("before")));
        // Recording starts while no pass is asking.
        recorder.recording = true;
        yield* Effect.sleep("1500 millis");
        const held = yield* Effect.fork(
          gate.run(Effect.sync(() => order.push("held")))
        );
        yield* Effect.sleep("1500 millis");
        order.push("stop");
        recorder.recording = false;
        yield* Fiber.join(held);
      }).pipe(Effect.provide(recorderGpuGateLayer(url)), Effect.scoped)
    );
    expect(order).toEqual(["before", "stop", "held"]);
  }, 15_000);
});
