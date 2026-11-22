import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  banOf,
  configOverrides,
  type Diagnostic,
  lintProbes,
  ownerPathExists,
} from "./lint-probe.ts";

const PROBE = [
  "export const copy = (video: { id: string }) =>",
  "  navigator.clipboard.writeText(video.id);",
  "export const base = () => window.location.origin;",
  "export const clock = (s: number) =>",
  '  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;',
  "",
].join("\n");

type Ban = "entity-links" | "duration-format";

const BOTH: readonly Ban[] = ["entity-links", "duration-format"];

const FILES: Record<string, readonly Ban[]> = {
  "apps/local/app/features/video-editor/probe.ts": BOTH,
  "apps/local/app/features/video-editor/probe.test.ts": BOTH,
  "apps/local/app/routes/_app.probe.tsx": BOTH,
  "apps/local/app/lib/probe.ts": BOTH,
  "apps/local/app/lib/format-duration.test.ts": BOTH,
  "packages/core/services/probe.ts": BOTH,
  "scripts/probe.ts": BOTH,
  "apps/local/app/features/entity-links/probe.ts": ["duration-format"],
  "apps/local/app/features/entity-links/probe.test.ts": ["duration-format"],
  "apps/local/app/lib/format-duration.ts": ["entity-links"],
};

let diagnostics: Diagnostic[];
let removeProbes: () => void;

beforeAll(() => {
  const probes = lintProbes(
    Object.fromEntries(Object.keys(FILES).map((file) => [file, PROBE]))
  );
  removeProbes = probes.remove;
  diagnostics = probes.diagnostics;
});

afterAll(() => {
  removeProbes();
});

const reportsIn = (file: string) =>
  diagnostics.filter((d) => d.filename === file);

describe("the display guards and their owners", () => {
  it.each(Object.entries(FILES))("%s fails exactly %j", (file, bans) => {
    const found = reportsIn(file)
      .map(banOf)
      .filter((ban) => ban !== undefined);
    expect([...new Set(found)].sort()).toEqual([...bans].sort());
  });

  it.each([
    ["entity-links", "EntityMenuContent"],
    ["entity-links", "entityDeepLink"],
    ["duration-format", "formatDuration"],
  ] as const)("the %s message names %s", (ban, guidance) => {
    const found = reportsIn(
      "apps/local/app/features/video-editor/probe.ts"
    ).find((d) => banOf(d) === ban);
    expect(`${found?.message} ${found?.help}`).toContain(guidance);
  });
});

const OWNED_RULES = ["local/entity-links", "local/duration-format"];

const ownerPaths = () =>
  configOverrides()
    .filter((override) =>
      Object.keys(override.rules).some((rule) => OWNED_RULES.includes(rule))
    )
    .flatMap((override) => override.files);

describe("the display guards' owner overrides", () => {
  it("list an owner for each rule", () => {
    expect(ownerPaths().sort()).toEqual([
      "apps/local/app/features/entity-links/**",
      "apps/local/app/lib/format-duration.ts",
    ]);
  });

  it.each(ownerPaths())("%s exists in the repo", (file) => {
    expect(ownerPathExists(file)).toBe(true);
  });
});
