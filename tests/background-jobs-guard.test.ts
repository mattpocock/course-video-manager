import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWLIST_PATH,
  compare,
  scan,
  type Allowlist,
  type Hit,
} from "../scripts/check-background-jobs";

const ROUTE = "apps/local/app/routes/api.videos.$videoId.thing.ts";
const CLIENT = "apps/local/app/features/upload-manager/sse-thing-client.ts";
const SERVICE = "apps/local/app/services/thing.ts";

const guards = (hits: Hit[]) => hits.map((h) => h.guard);

describe("scan", () => {
  it("finds a route streaming a job back, by helper or by hand", () => {
    expect(
      guards(
        scan(
          ROUTE,
          `export const action = () => createSSEResponse(program);
           const h = { "Content-Type": "text/event-stream" };`
        )
      )
    ).toEqual(["sse-route", "sse-route"]);
  });

  it("finds each way a browser keeps a job alive", () => {
    expect(
      guards(
        scan(
          CLIENT,
          `consumeSSEStream({ url });
           const s = new EventSource("/x");
           while (!unmounted) { await poll(); }`
        )
      )
    ).toEqual(["browser-driver", "browser-driver", "browser-driver"]);
  });

  it("finds a process started with @effect/platform's Command, under any name", () => {
    expect(
      guards(
        scan(
          SERVICE,
          `import { Command, FileSystem } from "@effect/platform";
           const c = Command.make("ffmpeg", "-i", file);`
        )
      )
    ).toEqual(["spawn"]);
    expect(
      guards(
        scan(
          SERVICE,
          `import { Command as Proc } from "@effect/platform";
           Proc.make("ls");`
        )
      )
    ).toEqual(["spawn"]);
    expect(
      guards(
        scan(
          SERVICE,
          `import * as Cmd from "@effect/platform/Command";
           Cmd.make("ls");`
        )
      )
    ).toEqual(["spawn"]);
  });

  it("does not count @effect/cli's Command, which starts no process", () => {
    expect(
      scan(
        "apps/local/app/cli/commands/thing.ts",
        `import { Command } from "@effect/cli";
         export const cmd = Command.make("list", {}, () => run);`
      )
    ).toEqual([]);
  });

  it("finds outbound network and AI calls in server and CLI code", () => {
    expect(
      guards(
        scan(
          "apps/local/app/services/new-thing.ts",
          `import { generateText, ToolLoopAgent as Agent } from "ai";
           import OpenAI from "openai";
           import { v2 as cloudinary } from "cloudinary";
           await fetch("https://api.example.com");
           await generateText({ model });
           new Agent({ model });
           new OpenAI({ apiKey });
           cloudinary.uploader.upload(file);
           cloudinary.config({});`
        )
      )
    ).toEqual(["network", "network", "network", "network", "network"]);
  });

  it("does not count the app calling itself, a property named fetch or the Sidecar", () => {
    expect(
      scan(
        "apps/local/app/features/client-thing.tsx",
        'fetch("/api/x"); fetch(`/api/${id}`); fetch(a ? "/x" : `/y/${b}`);' +
          `app.fetch(req); const o = { fetch: (id) => id }; o.fetch(1);`
      )
    ).toEqual([]);
    expect(
      scan("apps/local/sidecar/kinds/thing.ts", `fetch("https://a.com");`)
    ).toEqual([]);
  });

  // Each way the review of batch 10 got a call past the guard.
  it.each([
    [
      "a wrapper in features/",
      "apps/local/app/features/net/http.ts",
      `export const f = () => fetch("https://a.com");`,
    ],
    [
      "a .tsx loader",
      "apps/local/app/routes/courses.$id.tsx",
      `export const loader = () => fetch("https://a.com");`,
    ],
    [
      "an aliased fetch",
      SERVICE,
      `const get = fetch;\nexport const f = () => get("https://a.com");`,
    ],
    [
      "fetch off globalThis",
      SERVICE,
      `const { fetch: get } = globalThis; const g = globalThis["fetch"];`,
    ],
    [
      "a fetch bound elsewhere in the file",
      SERVICE,
      `const helper = (fetch: any) => fetch;\nexport const f = () => fetch("https://a.com");`,
    ],
    [
      "a namespace import of ai",
      SERVICE,
      `import * as ai from "ai";\nexport const f = () => ai.generateText({} as any);`,
    ],
    [
      "an aliased Cloudinary uploader",
      SERVICE,
      `import { v2 as cloudinary } from "cloudinary";\nconst up = cloudinary.uploader;`,
    ],
    [
      "a provider model called directly",
      SERVICE,
      `import { anthropic } from "@ai-sdk/anthropic";\nanthropic("m").doGenerate({});`,
    ],
    [
      "Effect's HTTP client",
      SERVICE,
      `import { HttpClient } from "@effect/platform";\nexport const c = HttpClient.HttpClient;`,
    ],
    [
      "the http package's fetch, under any name",
      SERVICE,
      `import { httpRequest as get } from "@/packages/http";\nexport const f = () => get("https://a.com");`,
    ],
  ])("counts %s", (_, file, source) => {
    expect(guards(scan(file, source))).toContain("network");
  });

  it("ignores comments, tests, the jobs feature and code outside the app", () => {
    const src = `createSSEResponse(p); consumeSSEStream(c); new EventSource("/x");`;
    expect(scan(ROUTE, `// createSSEResponse(program)`)).toEqual([]);
    expect(scan("apps/local/app/routes/x.test.ts", src)).toEqual([]);
    expect(scan("apps/local/app/features/jobs/use-job-events.ts", src)).toEqual(
      []
    );
    expect(scan("apps/local/sidecar/socket.ts", src)).toEqual([]);
  });
});

describe("compare", () => {
  const hit = (guard: Hit["guard"]): Hit => ({ guard, line: 1, text: "" });
  const allowlist: Allowlist = {
    "sse-route": [{ file: ROUTE, count: 1, reason: "moves in batch 2" }],
  };

  it("fails a new background job outside the sidecar", () => {
    const found = new Map([[CLIENT, [hit("browser-driver")]]]);
    expect(compare(found, allowlist, new Set([CLIENT]), false)).toHaveLength(1);
  });

  it("fails an entry once its file has fewer hits, so the list only shrinks", () => {
    const problems = compare(new Map(), allowlist, new Set([ROUTE]), false);
    expect(problems.join()).toMatch(/delete the entry/);
  });

  it("passes when every hit is on the list", () => {
    const found = new Map([[ROUTE, [hit("sse-route")]]]);
    expect(compare(found, allowlist, new Set([ROUTE]), true)).toEqual([]);
  });
});

// ADR 0032 section 7 names every file the guards let start a process, stream
// or loop outside the Sidecar. This holds the ADR to the guards' own lists:
// add a file to either list and the ADR must say why it stays.
describe("ADR 0032 names every allowed entry point", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const adr = readFileSync(
    path.join(root, "docs/adr/0032-background-work-runs-in-the-sidecar.md"),
    "utf8"
  );
  // Section 7 only, up to the next heading: a path named elsewhere in the
  // ADR does not count as a reason the file stays.
  const section7 = adr.slice(
    adr.indexOf("7. **What stays outside the Sidecar"),
    adr.indexOf("\n## ", adr.indexOf("7. **What stays outside the Sidecar"))
  );
  // The repo-relative path, whole, in backticks: `…/client.ts` alone would
  // let any new client.ts through.
  const named = (file: string) => section7.includes(`\`${file}\``);

  const allowlist = JSON.parse(
    readFileSync(path.join(root, ALLOWLIST_PATH), "utf8")
  ) as Allowlist;
  const allowlisted = Object.values(allowlist).flatMap((entries) =>
    (entries ?? []).map((e) => e.file)
  );

  type Config = { forbidden: { name: string; from: { pathNot?: string } }[] };
  const entryPoints = (config: string, rule: string) =>
    (
      (
        createRequire(import.meta.url)(path.join(root, config)) as Config
      ).forbidden.find((r) => r.name === rule)?.from.pathNot ?? ""
    )
      .split("|")
      .filter((pattern) => pattern !== "^sidecar/")
      // "^app/routes/api\\.feedback\\.ts$" → "apps/local/app/routes/api.feedback.ts"
      .map((pattern) =>
        path.posix.join(
          "apps/local",
          pattern.replace(/^\^|\$$/g, "").replace(/\\/g, "")
        )
      );
  const childProcessEntryPoints = entryPoints(
    "apps/local/.dependency-cruiser.spawn.cjs",
    "child-process-outside-interactive-entry-points"
  );
  const networkEntryPoints = entryPoints(
    "apps/local/.dependency-cruiser.network.cjs",
    "network-client-outside-entry-points"
  );

  it("reads both lists", () => {
    expect(allowlisted.length).toBeGreaterThan(0);
    expect(section7.length).toBeGreaterThan(0);
    expect(childProcessEntryPoints).toContain(
      "apps/local/app/routes/api.feedback.ts"
    );
    expect(networkEntryPoints).toContain(
      "apps/local/app/services/writer-stream-errors.ts"
    );
  });

  it.each(allowlisted)("names %s, from the allowlist", (file) => {
    expect(named(file)).toBe(true);
  });

  it.each(childProcessEntryPoints)(
    "names %s, from .dependency-cruiser.spawn.cjs",
    (file) => {
      expect(named(file)).toBe(true);
    }
  );

  it.each(networkEntryPoints)(
    "names %s, from .dependency-cruiser.network.cjs",
    (file) => {
      expect(named(file)).toBe(true);
    }
  );

  it.each([
    "apps/local/app/services/new-thing/client.ts",
    "apps/local/app/features/x/job-kind.ts",
    "apps/local/sidecar/kinds/transcribe-footage.ts",
  ])(
    "does not name %s, which shares only a basename or sits outside 7",
    (file) => {
      expect(named(file)).toBe(false);
    }
  );
});
