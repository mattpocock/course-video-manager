import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Diagnostic, lintProbes } from "./lint-probe.ts";

const APIS = [
  { api: "fetch", owner: "@/packages/http" },
  { api: "Date", owner: "@/packages/clock" },
  { api: "setTimeout", owner: "@/packages/clock" },
  { api: "setInterval", owner: "@/packages/clock" },
  { api: "clearTimeout", owner: "@/packages/clock" },
  { api: "clearInterval", owner: "@/packages/clock" },
  { api: "console", owner: "@/packages/log" },
  { api: "localStorage", owner: "useLocalStorage" },
  { api: "process.env", owner: "@/packages/env" },
  { api: "Math.random", owner: "@/packages/random" },
] as const;

type Api = (typeof APIS)[number]["api"];

const HOSTS = ["globalThis", "window", "self", "global"];

const QUALIFIED = APIS.filter(({ api }) => !api.includes(".")).flatMap(
  ({ api, owner }) => HOSTS.map((host) => ({ api: `${host}.${api}`, owner }))
);

const USES = [
  ...APIS.map(({ api }) => ({ name: api, source: api })),
  ...QUALIFIED.map(({ api }) => ({ name: api, source: api })),
  {
    name: "globalThis.localStorage",
    source: "(globalThis as typeof globalThis).localStorage",
  },
];

const PROBE = [
  ...USES.map(({ source }, i) => `export const use${i} = ${source};`),
  "export type OnlyAType = Date;",
  "export const annotated = (when: Date): Date => when;",
  "",
].join("\n");

const TIMERS: readonly Api[] = [
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
];

const FILES: Record<string, readonly Api[]> = {
  "apps/local/app/features/probe/probe.ts": [],
  "apps/local/app/features/probe/probe.test.ts": [],
  "packages/core/services/probe.test.ts": [],
  "apps/local/app/packages/env/lib/probe.ts": ["process.env"],
  "apps/local/app/packages/env/tests/probe.test.ts": [],
  "packages/core/db/database-url.ts": ["process.env"],
  "apps/local/app/packages/http/lib/probe.ts": ["fetch"],
  "apps/local/app/packages/http/tests/probe.test.ts": [],
  "apps/local/app/packages/clock/lib/probe.ts": ["Date", ...TIMERS],
  "apps/local/app/packages/clock/tests/probe.test.ts": [],
  "packages/core/features/time/london-time.ts": ["Date"],
  "packages/core/features/time/probe.ts": ["Date"],
  "packages/core/features/time/london-time.test.ts": [],
  "apps/local/app/packages/random/lib/probe.ts": ["Math.random"],
  "apps/local/app/packages/log/lib/probe.ts": ["console"],
  "apps/local/app/packages/log/tests/probe.test.ts": [],
  "apps/local/app/hooks/use-local-storage.ts": ["localStorage"],
};

let diagnostics: Diagnostic[];
let removeProbes: () => void;

beforeAll(() => {
  const probes = lintProbes(
    Object.fromEntries(Object.keys(FILES).map((file) => [file, PROBE]))
  );
  removeProbes = probes.remove;
  diagnostics = probes.diagnostics.filter((d) =>
    d.code.startsWith("eslint(no-restricted-")
  );
});

afterAll(() => {
  removeProbes();
});

const nameOf = (d: Diagnostic) => /'([^']+)'/.exec(d.message)?.[1];

const bannedIn = (file: string) =>
  diagnostics.filter((d) => d.filename === file).map(nameOf);

describe("one owner per global API", () => {
  it.each(Object.entries(FILES))("%s may use only %j", (file, allowed) => {
    expect(bannedIn(file).sort()).toEqual(
      USES.map(({ name }) => name)
        .filter((name) => !allowed.some((api) => api === name))
        .sort()
    );
  });

  it.each([...APIS, ...QUALIFIED])(
    "the ban on $api names its owner, $owner",
    ({ api, owner }) => {
      const found = diagnostics.find(
        (d) =>
          d.filename === "apps/local/app/features/probe/probe.ts" &&
          nameOf(d) === api
      );
      expect(`${found?.message} ${found?.help}`).toContain(owner);
    }
  );
});
