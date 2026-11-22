import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import noUnsafeAs from "./no-unsafe-as.js";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("no-unsafe-as", noUnsafeAs, {
  valid: [
    "const modes = ['a', 'b'] as const;",
    "const config = { port: 1 } satisfies { port: number };",
    "function cast<T>(value: unknown): T { return value as T; }",
    "class Store { get<T>(key: string): T { return this.read(key) as T; } }",
    "const store = { get<T>(key: string): T { return read(key) as T; } };",
    "function wrap<T>(items: unknown[]) { return items.map((item) => item as T); }",
    "const modes = <const>['a', 'b'];",
    "const cast = <T,>(value: unknown): T => value as T;",
  ],
  invalid: [
    {
      code: "const n = value as number;",
      errors: [{ messageId: "assertion" }],
    },
    {
      code: "const s = value as unknown as string;",
      errors: [{ messageId: "assertion" }, { messageId: "assertion" }],
    },
    {
      code: "const n = <number>value;",
      errors: [{ messageId: "assertion" }],
    },
    {
      code: "function parse(raw: string) { return JSON.parse(raw) as Config; }",
      errors: [{ messageId: "assertion" }],
    },
    {
      code: "function outer<T>() {}\nconst x = value as T;",
      errors: [{ messageId: "assertion", line: 2 }],
    },
    {
      code: "class Store<T> { get(key: string) { return read(key) as T; } }",
      errors: [{ messageId: "assertion" }],
    },
  ],
});
