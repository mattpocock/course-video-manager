import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import dbClients from "./db-clients.js";

RuleTester.describe = describe;
RuleTester.it = it;

const client = { messageId: "client" };
const url = { messageId: "url" };

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("db-clients", dbClients, {
  valid: [
    "const db = yield* DrizzleService;",
    "const { db, end } = scriptDrizzle();",
    "const pool = makeConnectionPool(url);",
    "const pool = new other.Pool({});",
    "const map = new Map();",
    "const client = createClient();",
    "process.env.DATABASE_URL = url;",
    "process.env.DIRECT_DATABASE_URL = url;",
    "process.env['DATABASE_URL'] = url;",
    "delete process.env.DATABASE_URL;",
    "delete process.env['DIRECT_DATABASE_URL'];",
    "const mode = process.env.NODE_ENV;",
    "const other = process.env['DATABASE_URL_SUFFIX'];",
    "const { PORT } = process.env;",
    "const { DATABASE_URL } = config;",
    "// new Pool({ connectionString })\nconst x = 1;",
    "/* drizzle(pool) */\nconst x = 1;",
    "const text = 'process.env.DATABASE_URL';",
    {
      code: "const u = process.env.DATABASE_URL;",
      options: [{ reads: false }],
    },
    {
      code: "const { DATABASE_URL } = process.env;",
      options: [{ reads: false }],
    },
  ],
  invalid: [
    { code: "const pool = new Pool({ connectionString });", errors: [client] },
    {
      code: "const pool = new pg.Pool({ connectionString });",
      errors: [client],
    },
    { code: "const c = new Client({ connectionString });", errors: [client] },
    {
      code: "const c = new pg.Client({ connectionString });",
      errors: [client],
    },
    { code: "const sql = postgres(url);", errors: [client] },
    { code: "const sql = neon(url);", errors: [client] },
    { code: "const db = drizzle(pool, { schema });", errors: [client] },
    { code: "const db = orm.drizzle(pool);", errors: [client] },
    { code: "const db = new PGlite();", errors: [client] },
    { code: "const db = (0, drizzle)(pool);", errors: [client] },
    { code: "const db = orm['drizzle'](pool);", errors: [client] },
    { code: "const db = orm?.drizzle(pool);", errors: [client] },
    { code: "const pool = new pg['Pool']({});", errors: [client] },
    { code: "const pool = new (0, Pool)({});", errors: [client] },
    {
      code: "const db = drizzle(new Pool({ connectionString }));",
      errors: [client, client],
    },
    { code: "const u = process.env.DATABASE_URL;", errors: [url] },
    { code: "const u = process.env.DIRECT_DATABASE_URL;", errors: [url] },
    { code: "const u = process.env['DATABASE_URL'];", errors: [url] },
    { code: 'const u = process.env["DIRECT_DATABASE_URL"];', errors: [url] },
    { code: "const u = process.env[`DATABASE_URL`];", errors: [url] },
    { code: "const u = process.env?.DATABASE_URL;", errors: [url] },
    { code: "if (process.env.DATABASE_URL === url) {}", errors: [url] },
    { code: "process.env.DATABASE_URL ??= url;", errors: [url] },
    { code: "const { DATABASE_URL } = process.env;", errors: [url] },
    { code: "const { DIRECT_DATABASE_URL: u } = process.env;", errors: [url] },
    {
      code: "const { PORT, DATABASE_URL, DIRECT_DATABASE_URL } = process.env;",
      errors: [url, url],
    },
    { code: "let u; ({ DATABASE_URL: u } = process.env);", errors: [url] },
    { code: "const { ['DATABASE_URL']: u } = process.env;", errors: [url] },
    {
      code: "const pool = new Pool({});",
      options: [{ reads: false }],
      errors: [client],
    },
  ],
});
