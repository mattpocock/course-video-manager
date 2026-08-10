import { CliConfig, Command } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import * as Console from "effect/Console";
import { ensureDatabaseUrl } from "./env";
import { rootCommand } from "./index";
import { cliRuntime, type CliServices } from "./layer";
import { CliOutput } from "./output";
import { renderToExitCode } from "./render";

/**
 * A Console implementation that routes @effect/cli's built-in writes through the
 * CliOutput seam instead of the real process streams.
 *
 * @effect/cli prints help / completions via Console.log and its human-readable
 * VALIDATION error docs via Console.error (see @effect/cli internal/cliApp). The
 * latter would otherwise leak a prose line onto the real stderr ALONGSIDE the
 * renderer's contract JSON, breaking `JSON.parse(stderr)` and escaping the test
 * seam. So:
 *   - log  -> CliOutput.stdout (help/completions stay capturable, exit 0)
 *   - error-> SUPPRESSED; renderToExitCode emits the single contract JSON for
 *             the same ValidationError, keeping STDERR one parseable object.
 * Everything else is a no-op (the CLI uses only log/error).
 */
const makeCliConsole = (out: {
  readonly stdout: (text: string) => Effect.Effect<void>;
}): Console.Console => {
  const noop = Effect.void;
  return {
    [Console.TypeId]: Console.TypeId,
    log: (...args: ReadonlyArray<unknown>) =>
      out.stdout(args.map(String).join(" ") + "\n"),
    error: () => noop,
    assert: () => noop,
    clear: noop,
    count: () => noop,
    countReset: () => noop,
    debug: () => noop,
    dir: () => noop,
    dirxml: () => noop,
    group: () => noop,
    groupEnd: noop,
    info: () => noop,
    table: () => noop,
    time: () => noop,
    timeEnd: () => noop,
    timeLog: () => noop,
    trace: () => noop,
    warn: () => noop,
    unsafe: {
      assert: () => {},
      clear: () => {},
      count: () => {},
      countReset: () => {},
      debug: () => {},
      dir: () => {},
      dirxml: () => {},
      error: () => {},
      group: () => {},
      groupCollapsed: () => {},
      groupEnd: () => {},
      info: () => {},
      log: () => {},
      table: () => {},
      time: () => {},
      timeEnd: () => {},
      timeLog: () => {},
      trace: () => {},
      warn: () => {},
    },
  };
};

export const CLI_NAME = "cvm";
export const CLI_VERSION = "1.0.0";

const cliRun = Command.run(rootCommand, {
  name: CLI_NAME,
  version: CLI_VERSION,
});

/**
 * Build the runnable program for `argv`, resolving to the process EXIT CODE.
 * Never fails, never calls process.exit. The CLI environment (FileSystem/Path/
 * Terminal) and a cleaned-up CliConfig (built-ins hidden from help) are
 * provided here; the read-operations services come from `cliRuntime` and
 * CliOutput is provided by the caller (real streams in prod, captured in tests).
 *
 * @example // test
 * const out = makeTestCliOutput();
 * const code = await cliRuntime.runPromise(
 *   buildProgram(["video", "list"]).pipe(Effect.provide(out.layer))
 * );
 */
export const buildProgram = (
  argv: ReadonlyArray<string>
): Effect.Effect<number, never, CliServices | CliOutput> =>
  // @effect/cli's `run` always drops the first two argv entries (it assumes
  // `node <script> ...`). `argv` here is the USER args (everything after
  // `cvm`), so prepend two placeholder tokens to keep them intact.
  renderToExitCode(
    Effect.flatMap(CliOutput, (out) =>
      cliRun(["node", CLI_NAME, ...argv]).pipe(
        Effect.provide(CliConfig.layer({ showBuiltIns: false })),
        Effect.provide(NodeContext.layer),
        // Route @effect/cli's built-in Console writes through the CliOutput seam
        // so validation prose never leaks onto the real stderr (contract: STDERR
        // is a single JSON object emitted by renderToExitCode).
        Effect.withConsole(makeCliConsole(out))
      )
    )
  );

/**
 * Production entry point. Resolves DATABASE_URL from the install location,
 * then runs the program through the shared runtime with the real output
 * streams. Returns the exit code. process.exit happens only at the bin edge.
 */
export const runCli = (argv: ReadonlyArray<string>): Promise<number> => {
  const env = ensureDatabaseUrl();
  if (!env.ok) {
    process.stderr.write(JSON.stringify(env.error) + "\n");
    return Promise.resolve(4);
  }

  return cliRuntime.runPromise(
    buildProgram(argv).pipe(Effect.provide(CliOutput.Default))
  );
};
