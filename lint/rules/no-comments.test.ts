import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import noComments from "./no-comments.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const entryPoint = [{ allowInterfaceJsDoc: true }];
const deleting = (messageId: string, output: string, line?: number) => ({
  messageId,
  ...(line === undefined ? {} : { line }),
  suggestions: [{ messageId: "remove", output }],
});
const comment = (output: string, line?: number) =>
  deleting("comment", output, line);
const jsdoc = (output: string, line?: number) =>
  deleting("jsdoc", output, line);

const directives = [
  "// oxlint-disable-next-line no-debugger\ndebugger;",
  "/* oxlint-disable no-console */\nconsole.log(1);\n/* oxlint-enable no-console */",
  "console.log(1); // oxlint-disable-line no-console",
  "// eslint-disable-next-line no-console\nconsole.log(1);",
  "/* eslint-disable no-console */\nconsole.log(1);\n/* eslint-enable no-console */",
  "// @ts-expect-error the type system refuses this\nconst n: number = 'a';",
  "// @ts-ignore\nconst n: number = 'a';",
  "// @ts-nocheck\nexport {};",
  "// @ts-check\nexport {};",
  "// biome-ignore lint/suspicious/noConsole: fine\nconsole.log(1);",
  "// @effect-diagnostics-next-line globalErrorInEffectFailure:off\nthrow new Error('x');",
  "// @effect-diagnostics floatingEffect:off\nexport {};",
  '/// <reference types="vite/client" />\nexport {};',
  '/// <reference path="./globals.d.ts" />\nexport {};',
  "// prettier-ignore\nconst grid = [1,0,\n  0,1];",
  "/* prettier-ignore */\nconst grid = [1,0,\n  0,1];",
  "#!/usr/bin/env node\nconsole.log(1);",
];

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("no-comments", noComments, {
  valid: [
    "const x = 1;",
    "const s = '// not a comment';",
    "const t = `/* not a comment */`;",
    "const r = /\\/\\/ not a comment/;",
    ...directives,
    ...directives.map((code) => ({ code, options: entryPoint })),
    {
      code: "/**\n * The clock: every read of the current time.\n */\nimport { x } from './x';\nexport const now = () => x;",
      options: entryPoint,
    },
    {
      code: "#!/usr/bin/env node\n/** The CLI entry point. */\nconsole.log(1);",
      options: entryPoint,
    },
    {
      code: '/// <reference types="vite/client" />\n/** The module. */\nexport {};',
      options: entryPoint,
    },
    {
      code: "/** Today's date, in the user's time zone. */\nexport function today(): string { return ''; }",
      options: entryPoint,
    },
    {
      code: "const a = 1;\n/** The answer. */\nexport const answer = 42;",
      options: entryPoint,
    },
    {
      code: "const a = 1;\n/** The default export. */\nexport default function main() {}",
      options: entryPoint,
    },
    {
      code: "const a = 1;\n/** Re-exported as is. */\nexport { a };",
      options: entryPoint,
    },
    {
      code: "const a = 1;\n/** Everything in x. */\nexport * from './x';",
      options: entryPoint,
    },
    {
      code: "const a = 1;\n/** A clock. */\nexport class Clock {\n  /** Now, in milliseconds. */\n  now(): number { return 0; }\n  /** The time zone. */\n  zone = 'UTC';\n  /** The offset. */\n  get offset(): number { return 0; }\n}",
      options: entryPoint,
    },
    {
      code: "const a = 1;\nexport class Clock {\n  /** Now, in milliseconds. */\n  static now(): number { return 0; }\n}",
      options: entryPoint,
    },
    {
      code: "const a = 1;\n/** A clock. */\nexport interface Clock {\n  /** Now, in milliseconds. */\n  now(): number;\n  /** The time zone. */\n  zone: string;\n}",
      options: entryPoint,
    },
    {
      code: "const a = 1;\nexport type Clock = {\n  /** Now, in milliseconds. */\n  now(): number;\n};",
      options: entryPoint,
    },
    {
      code: "const a = 1;\nexport const clock = {\n  /** Now, in milliseconds. */\n  now: () => 0,\n  /** Today. */\n  today() { return ''; },\n};",
      options: entryPoint,
    },
    {
      code: "const a = 1;\n/** The answer. */\n// oxlint-disable-next-line no-magic-numbers\nexport const answer = 42;",
      options: entryPoint,
    },
    {
      code: "/** The module. */\n/** The answer. */\nexport const answer = 42;",
      options: entryPoint,
    },
  ],
  invalid: [
    {
      code: "// a line comment\nconst x = 1;",
      errors: [comment("const x = 1;")],
    },
    {
      code: "// a line comment\r\nconst x = 1;",
      errors: [comment("const x = 1;")],
    },
    {
      code: "const x = 1; // trailing",
      errors: [comment("const x = 1;")],
    },
    {
      code: "/* a block comment */\nconst x = 1;",
      errors: [comment("const x = 1;")],
    },
    {
      code: "/**/\nconst x = 1;",
      errors: [comment("const x = 1;")],
    },
    {
      code: "// a line comment\nconst x = 1;",
      options: entryPoint,
      errors: [comment("const x = 1;")],
    },
    {
      code: "const a = 1;\n// The answer.\nexport const answer = 42;",
      options: entryPoint,
      errors: [comment("const a = 1;\nexport const answer = 42;")],
    },
    {
      code: "const a = 1;\n/* The answer. */\nexport const answer = 42;",
      options: entryPoint,
      errors: [comment("const a = 1;\nexport const answer = 42;")],
    },
    {
      code: "// Never write an eslint-disable here: fix the code.\nexport {};",
      errors: [comment("export {};")],
    },
    {
      code: "// see prettier-ignore below\nexport {};",
      errors: [comment("export {};")],
    },
    {
      code: "/** The module. */\nexport const answer = 42;",
      errors: [jsdoc("export const answer = 42;")],
    },
    {
      code: "const a = 1;\n/** The answer. */\nexport const answer = 42;",
      errors: [jsdoc("const a = 1;\nexport const answer = 42;")],
    },
    {
      code: "const a = 1;\n/** Not exported. */\nconst hidden = 42;",
      options: entryPoint,
      errors: [jsdoc("const a = 1;\nconst hidden = 42;")],
    },
    {
      code: "const a = 1;\n/** Not exported. */\nfunction hidden() {}\nexport { hidden };",
      options: entryPoint,
      errors: [jsdoc("const a = 1;\nfunction hidden() {}\nexport { hidden };")],
    },
    {
      code: "const a = 1;\nexport function f() {\n  /** Inside a body. */\n  const x = 1;\n  return x;\n}",
      options: entryPoint,
      errors: [
        jsdoc(
          "const a = 1;\nexport function f() {\n  const x = 1;\n  return x;\n}"
        ),
      ],
    },
    {
      code: "const a = 1;\nclass Hidden {\n  /** Not exported. */\n  now(): number { return 0; }\n}",
      options: entryPoint,
      errors: [
        jsdoc("const a = 1;\nclass Hidden {\n  now(): number { return 0; }\n}"),
      ],
    },
    {
      code: "const a = 1;\n/** First. */\n/** Second, the one that counts. */\nexport const answer = 42;",
      options: entryPoint,
      errors: [
        jsdoc(
          "const a = 1;\n/** Second, the one that counts. */\nexport const answer = 42;",
          2
        ),
      ],
    },
    {
      code: "const a = 1;\n/** The answer. */\n// a note\nexport const answer = 42;",
      options: entryPoint,
      errors: [
        jsdoc("const a = 1;\n// a note\nexport const answer = 42;", 2),
        comment(
          "const a = 1;\n/** The answer. */\nexport const answer = 42;",
          3
        ),
      ],
    },
    {
      code: "const a = 1;\nexport const answer = 42;\n/** Trailing, before nothing. */",
      options: entryPoint,
      errors: [jsdoc("const a = 1;\nexport const answer = 42;\n")],
    },
    {
      code: "const a = 1;\nexport const answer = /** Inside the value. */ 42;",
      options: entryPoint,
      errors: [jsdoc("const a = 1;\nexport const answer = 42;")],
    },
  ],
});
