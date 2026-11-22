import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import scriptDbUrl from "./script-db-url.js";

RuleTester.describe = describe;
RuleTester.it = it;

const url = { messageId: "url" };
const loadEnvFile = { messageId: "loadEnvFile" };

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("script-db-url", scriptDbUrl, {
  valid: [
    "const { url, host } = scriptDatabaseUrl();",
    "const { url } = scriptDatabaseUrl({ direct: true });",
    "const mode = process.env.NODE_ENV;",
    "const other = process.env['DATABASE_URL_SUFFIX'];",
    "const { DATABASE_URL } = config;",
    "// process.env.DATABASE_URL\nconst x = 1;",
    "/* process.loadEnvFile() */\nconst x = 1;",
    "const text = 'process.env.DATABASE_URL';",
  ],
  invalid: [
    { code: "const u = process.env.DATABASE_URL;", errors: [url] },
    { code: "const u = process.env.DIRECT_DATABASE_URL;", errors: [url] },
    { code: "const u = process.env['DATABASE_URL'];", errors: [url] },
    { code: 'const u = process.env["DIRECT_DATABASE_URL"];', errors: [url] },
    { code: "const u = process.env[`DATABASE_URL`];", errors: [url] },
    { code: "process.env.DATABASE_URL = url;", errors: [url] },
    { code: "const { DATABASE_URL } = process.env;", errors: [url] },
    { code: "process.loadEnvFile('.env');", errors: [loadEnvFile] },
    {
      code: "import { loadEnvFile } from 'node:process';\nloadEnvFile();",
      errors: [loadEnvFile, loadEnvFile],
    },
  ],
});
