#!/usr/bin/env node
/**
 * The outermost bin edge for the globally-linked `cvm` command. This is the
 * ONLY place process.exit is allowed.
 *
 * It is a PLAIN Node launcher and runs the CLI on plain Node too: no tsx at
 * runtime. `loadCli` imports an esbuild bundle of `main.ts` that resolves the
 * tsconfig `@/*` aliases from THIS project's tsconfig, so `cvm` works from any
 * directory, and rebuilds that bundle first whenever a source file has changed
 * since it was built (see bundle.mjs). CVM_API_URL / CVM_API_TOKEN (and, while
 * some verbs are still wired in-process, DATABASE_URL) are resolved inside
 * runCli, anchored to this install location.
 */
import { loadCli } from "./bundle.mjs";

const { runCli } = await loadCli();

/**
 * Exit only once stdout and stderr have flushed. When stdout is a PIPE
 * (`cvm … | jq`), Node writes to it asynchronously, so a bare process.exit
 * drops everything past the first 64KB still sitting in the pipe buffer — a
 * large `course tree --depth all` reached jq cut off mid-object. An empty
 * write's callback fires only after every write queued before it, so waiting
 * on one per stream guarantees the output is complete before exiting.
 */
const flushThenExit = (code) => {
  let pending = 2;
  const done = () => {
    pending -= 1;
    if (pending === 0) process.exit(code);
  };
  process.stdout.write("", done);
  process.stderr.write("", done);
};

runCli(process.argv.slice(2)).then(
  (code) => flushThenExit(code),
  (cause) => {
    // Last-resort guard: runCli is designed never to reject, but if something
    // escapes, render a clean DatabaseError (never a raw stack) and exit 4.
    process.stderr.write(
      JSON.stringify({ _tag: "DatabaseError", message: String(cause) }) + "\n"
    );
    flushThenExit(4);
  }
);
