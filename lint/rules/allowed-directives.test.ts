import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import allowedDirectives from "./allowed-directives.js";

RuleTester.describe = describe;
RuleTester.it = it;

const allowlist = path.join(
  mkdtempSync(path.join(tmpdir(), "allowed-directives-")),
  "allowed-directives.json"
);
writeFileSync(
  allowlist,
  JSON.stringify([
    {
      file: "src/listed.ts",
      directive: "oxlint-disable-next-line no-debugger",
      reason: "A planted breakpoint the test needs.",
    },
    {
      file: "src/listed.ts",
      directive: "@ts-expect-error the type system refuses this",
      reason: "The test pins a compile error.",
    },
    {
      file: "src/listed.ts",
      directive: "eslint-disable-next-line no-empty",
      reason: "  ",
    },
  ])
);

const options = [{ allowlist }];
const filename = "src/listed.ts";
const unlisted = (code: string, directive: string) => ({
  code,
  filename,
  options,
  errors: [{ messageId: "directive", data: { directive } }],
});

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("allowed-directives", allowedDirectives, {
  valid: [
    {
      code: "// oxlint-disable-next-line no-debugger\ndebugger;",
      filename,
      options,
    },
    {
      code: "// @ts-expect-error the type system refuses this\nconst n: number = 'a';",
      filename,
      options,
    },
    {
      code: "// prettier-ignore\nconst grid = [1,0,\n  0,1];",
      filename,
      options,
    },
    {
      code: '/// <reference types="vite/client" />\nexport {};',
      filename,
      options,
    },
    {
      code: "// Never write an eslint-disable here: fix the code.\nexport {};",
      filename,
      options,
    },
  ],
  invalid: [
    unlisted(
      "// oxlint-disable-next-line no-console\nconsole.log(1);",
      "oxlint-disable-next-line no-console"
    ),
    unlisted(
      "/* oxlint-disable no-console */\nconsole.log(1);",
      "oxlint-disable no-console"
    ),
    unlisted(
      "console.log(1); // oxlint-disable-line no-console",
      "oxlint-disable-line no-console"
    ),
    unlisted(
      "// eslint-disable-next-line no-console\nconsole.log(1);",
      "eslint-disable-next-line no-console"
    ),
    unlisted("/* eslint-disable */\nconsole.log(1);", "eslint-disable"),
    unlisted(
      "// @ts-expect-error some other reason\nconst n: number = 'a';",
      "@ts-expect-error some other reason"
    ),
    unlisted("// @ts-ignore\nconst n: number = 'a';", "@ts-ignore"),
    unlisted("/* @ts-nocheck */\nexport {};", "@ts-nocheck"),
    unlisted(
      "// biome-ignore lint/suspicious/noConsole: fine\nconsole.log(1);",
      "biome-ignore lint/suspicious/noConsole: fine"
    ),
    unlisted(
      "// @effect-diagnostics-next-line globalErrorInEffectFailure:off\nthrow new Error('x');",
      "@effect-diagnostics-next-line globalErrorInEffectFailure:off"
    ),
    unlisted(
      "// @effect-diagnostics floatingEffect:off\nexport {};",
      "@effect-diagnostics floatingEffect:off"
    ),
    {
      ...unlisted(
        "// oxlint-disable-next-line no-debugger\ndebugger;",
        "oxlint-disable-next-line no-debugger"
      ),
      filename: "src/other.ts",
    },
    unlisted(
      "// eslint-disable-next-line no-empty\nif (1) {}",
      "eslint-disable-next-line no-empty"
    ),
  ],
});
