import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import noCjsPaths from "./no-cjs-paths.js";

RuleTester.describe = describe;
RuleTester.it = it;

const cjs = { messageId: "cjs" };

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("no-cjs-paths", noCjsPaths, {
  valid: [
    "const dir = import.meta.dirname;",
    "const file = import.meta.filename;",
    "const p = path.join(import.meta.dirname, 'x');",
    "// const dir = __dirname;\nconst x = 1;",
    "/* __filename */\nconst x = 1;",
    "const s = '__dirname';",
    "const s = `__filename`;",
    "const dirname = 1;",
    "const my__dirname = 1;",
    "const __dirnames = 1;",
    "const o = { dirname: import.meta.dirname };",
  ],
  invalid: [
    { code: "const dir = __dirname;", errors: [cjs] },
    { code: "const file = __filename;", errors: [cjs] },
    { code: "readFileSync(path.join(__dirname, 'x.json'));", errors: [cjs] },
    { code: "const p = `${__dirname}/x`;", errors: [cjs] },
    {
      code: "const __dirname = path.dirname(fileURLToPath(import.meta.url));\nconst p = path.join(__dirname, 'x');",
      errors: [cjs, cjs],
    },
    {
      code: "const __filename = fileURLToPath(import.meta.url);",
      errors: [cjs],
    },
    { code: "const d = globalThis.__dirname;", errors: [cjs] },
    { code: "const d = globalThis['__dirname'];", errors: [cjs] },
    { code: "const d = globalThis[`__filename`];", errors: [cjs] },
    { code: "const { __dirname: d } = globalThis;", errors: [cjs] },
    { code: "const { ['__filename']: f } = globalThis;", errors: [cjs] },
    { code: "function f(__dirname: string) {}", errors: [cjs] },
    { code: "export { __dirname };", errors: [cjs] },
    { code: "const { __filename } = globalThis;", errors: [cjs] },
  ],
});
