import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import durationFormat from "./duration-format.js";

RuleTester.describe = describe;
RuleTester.it = it;

const handRolled = { messageId: "handRolled" };

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("duration-format", durationFormat, {
  valid: [
    "const rest = minutes % 60;",
    "const s = String(n).padStart(2, '0');",
    "const s = formatDuration(seconds);",
    "const a = n % 600;\nconst s = String(n).padStart(2, '0');",
    "const a = n % 6;\nconst s = String(n).padStart(2, '0');",
    "const a = n % 60;\nconst s = String(n).padStart(20, ' ');",
    "const a = n % 60;\nconst s = String(n).padStart(3, '0');",
    "const a = n % 60;\nconst s = String(n).padEnd(2, '0');",
    "const a = n / 60;\nconst s = String(n).padStart(2, '0');",
    "const a = 60 % n;\nconst s = String(n).padStart(2, '0');",
    "const a = n % 60;\nconst s = padStart(2);",
    "const a = n % 60;\n// String(n).padStart(2, '0')",
    "const a = n % 60;\nconst s = 'x.padStart(2, \"0\")';",
    "const a = 'n % 60';\nconst s = String(n).padStart(2, '0');",
  ],
  invalid: [
    {
      code: "const s = String(whole % 60).padStart(2, '0');",
      errors: [handRolled],
    },
    {
      code: "const m = Math.floor(t / 60) % 60;\nconst s = t % 60;\nreturn `${m}:${String(s).padStart(2, '0')}`;",
      errors: [handRolled, handRolled],
    },
    {
      code: "const pad = (n: number) => `${n}`.padStart(2, '0');\nexport const f = (t: number) => `${pad(Math.floor(t / 60))}:${pad(t%60)}`;",
      errors: [handRolled],
    },
    {
      code: "const s = String(t % 60.0).padStart(2);",
      errors: [handRolled],
    },
    {
      code: "let s = t;\ns %= 60;\nconst out = String(s).padStart(2, '0');",
      errors: [handRolled],
    },
    {
      code: "const s = (t % 60).toString()['padStart'](2, '0');",
      errors: [handRolled],
    },
    {
      code: "const s = String(t % (60)).padStart(2, '0');",
      errors: [handRolled],
    },
  ],
});
