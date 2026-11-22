import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ENTRY = path.resolve(import.meta.dirname, "../index.ts");
const TSX = path.resolve(
  import.meta.dirname,
  "../../../../node_modules/.bin/tsx"
);

const run = (script: string) => {
  const result = spawnSync(
    TSX,
    ["--eval", `import { log } from ${JSON.stringify(ENTRY)};\n${script}`],
    { encoding: "utf8" }
  );
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
};

describe("log", () => {
  it("writes info and debug lines to stdout", () => {
    expect(run(`log.info("hello", 1); log.debug("detail");`)).toEqual({
      stdout: "hello 1\ndetail\n",
      stderr: "",
      status: 0,
    });
  });

  it("writes warnings and errors to stderr", () => {
    expect(
      run(`log.warn("careful"); log.error("broke", { code: 2 });`)
    ).toEqual({
      stdout: "",
      stderr: "careful\nbroke { code: 2 }\n",
      status: 0,
    });
  });
});
