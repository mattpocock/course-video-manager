import { Effect, Layer } from "effect";

/**
 * The single seam through which ALL CLI output flows. Command logic must NEVER
 * call console.log/process.stdout directly — yield CliOutput and use it (or,
 * preferably, the higher-level emit* helpers in ./helpers.ts).
 *
 * Writes are RAW: callers are responsible for trailing newlines. This keeps the
 * service dumb and the emit helpers in full control of formatting.
 *
 * The default layer writes to the real process streams. Tests provide a
 * captured layer (see `makeTestCliOutput`) so a command can be run through
 * `cliRuntime` and asserted against { stdout, stderr, exitCode } WITHOUT
 * spawning a subprocess.
 */
export class CliOutput extends Effect.Service<CliOutput>()("CliOutput", {
  sync: () => ({
    stdout: (text: string): Effect.Effect<void> =>
      Effect.sync(() => {
        process.stdout.write(text);
      }),
    stderr: (text: string): Effect.Effect<void> =>
      Effect.sync(() => {
        process.stderr.write(text);
      }),
  }),
}) {}

export interface TestCliOutput {
  /** Provide this layer in place of CliOutput.Default in tests. */
  readonly layer: Layer.Layer<CliOutput>;
  /** Everything written to stdout, concatenated. */
  readonly stdout: () => string;
  /** Everything written to stderr, concatenated. */
  readonly stderr: () => string;
}

/**
 * Build an in-memory CliOutput for tests.
 *
 * @example
 * const out = makeTestCliOutput();
 * const exitCode = await cliRuntime.runPromise(
 *   buildProgram(["video", "list"]).pipe(Effect.provide(out.layer))
 * );
 * expect(JSON.parse(out.stdout())).toEqual(...);
 * expect(exitCode).toBe(0);
 */
export const makeTestCliOutput = (): TestCliOutput => {
  let out = "";
  let err = "";
  const layer = Layer.succeed(CliOutput, {
    stdout: (text: string) =>
      Effect.sync(() => {
        out += text;
      }),
    stderr: (text: string) =>
      Effect.sync(() => {
        err += text;
      }),
  } as CliOutput);
  return {
    layer,
    stdout: () => out,
    stderr: () => err,
  };
};
