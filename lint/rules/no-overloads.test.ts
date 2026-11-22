import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import noOverloads from "./no-overloads.js";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("no-overloads", noOverloads, {
  valid: [
    "function plain(a: string): string { return a; }",
    "declare function ambient(a: string): string;\ndeclare function ambient(a: number): number;",
    "abstract class Shape { abstract area(): number; }",
    "class Box { size(): number { return 1; } }",
    "declare class Ambient { get(a: string): string; get(a: number): number; }",
    'declare module "lib" { function f(a: string): void; function f(a: number): void; }',
    "declare global { function f(a: string): void; function f(a: number): void; }",
    {
      code: "export function f(a: string): void;\nexport function f(a: number): void;",
      filename: "types.d.ts",
    },
  ],
  invalid: [
    {
      code: "function f(a: string): string;\nfunction f(a: number): number;\nfunction f(a: unknown) { return a; }",
      errors: [{ messageId: "overload" }, { messageId: "overload" }],
    },
    {
      code: "export function f(a: string): void;\nexport function f(a: unknown) {}",
      errors: [{ messageId: "overload" }],
    },
    {
      code: "class Box {\n  get(a: string): string;\n  get(a: unknown) { return a; }\n}",
      errors: [{ messageId: "overload", line: 2 }],
    },
  ],
});
