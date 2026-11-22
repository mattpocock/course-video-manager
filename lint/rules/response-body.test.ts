import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import responseBody from "./response-body.js";

RuleTester.describe = describe;
RuleTester.it = it;

const stream = { messageId: "stream" };
const cast = { messageId: "cast" };

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("response-body", responseBody, {
  valid: [
    "return new Response(webFileStream(path), { status: 200 });",
    "return new Response(webFileStream(path, { start, end }), { status: 206 });",
    "return new Response(JSON.stringify(body), { headers });",
    "return new Response(body as BodyInit);",
    "return new Response(null, { status: 204 });",
    "const body = stream as any;\n\n\n\nreturn new Response(body);",
    "return new Request(url, { body: stream as any });",
    "return Response.json(data as any);",
    "const x = new Response(body);\nconst y = z as unknown as T;",
    "return new Response(body as unknown);",
    "const s = createReadStreamLike(path);",
    "const s = readStream(path);",
    "const s = 'createReadStream';",
    "// createReadStream(path)\nconst x = 1;",
    "/* new Response(createReadStream(p) as any) */\nconst x = 1;",
  ],
  invalid: [
    { code: 'import { createReadStream } from "node:fs";', errors: [stream] },
    { code: 'import { createReadStream as crs } from "fs";', errors: [stream] },
    { code: "const s = fs.createReadStream(path);", errors: [stream] },
    { code: "const s = fs['createReadStream'](path);", errors: [stream] },
    { code: "const s = fs[`createReadStream`](path);", errors: [stream] },
    { code: "const s = fs?.createReadStream(path);", errors: [stream] },
    { code: "const { createReadStream } = fs;", errors: [stream] },
    {
      code: "const { createReadStream: c } = await import('node:fs');",
      errors: [stream],
    },
    { code: "const { ['createReadStream']: c } = fs;", errors: [stream] },
    { code: "const s = handle.createReadStream({ start });", errors: [stream] },
    {
      code: "return new Response(createReadStream(path) as any);",
      errors: [cast, stream],
    },
    { code: "return new Response(stream as any);", errors: [cast] },
    {
      code: "return new Response(stream as unknown as ReadableStream);",
      errors: [cast],
    },
    { code: "return new Response(<any>stream);", errors: [cast] },
    {
      code: "return new Response(\n  stream as\n      any,\n  { status: 200 }\n);",
      errors: [cast],
    },
    {
      code: "return new Response(body, { headers: headers as any });",
      errors: [cast],
    },
    { code: "return new globalThis.Response(stream as any);", errors: [cast] },
    { code: "return new Response((stream as any));", errors: [cast] },
    {
      code: "return new Response(wrap(() => stream as any));",
      errors: [cast],
    },
    {
      code: "return new Response(stream as any as BodyInit);",
      errors: [cast],
    },
  ],
});
