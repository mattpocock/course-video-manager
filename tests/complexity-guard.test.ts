import { describe, expect, it } from "vitest";
import {
  compare,
  findDisableComments,
  readRuleConfig,
  type Offender,
} from "../scripts/check-complexity";

const A = "apps/local/app/features/a.ts";
const B = "packages/core/b.ts";

const off = (file: string, complexity = 20, line = 1): Offender => ({
  file,
  line,
  complexity,
});

const run = (
  offenders: Offender[],
  allowlist: Record<string, number>,
  base?: Record<string, number>,
  overrideFiles = Object.keys(allowlist)
) => compare({ offenders, allowlist, base, overrideFiles, max: 15 });

describe("compare", () => {
  it("passes when every offender's file is allowlisted at its exact count", () => {
    expect(run([off(A), off(A, 30, 9)], { [A]: 2 }, { [A]: 2 })).toEqual([]);
  });

  it("fails a new over-limit function in a file that is not allowlisted", () => {
    const problems = run([off(B, 18, 4)], {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(B);
    expect(problems[0]).toContain("4 (18)");
  });

  it("fails a second over-limit function in an allowlisted file", () => {
    expect(run([off(A), off(A)], { [A]: 1 })[0]).toContain(
      "its allowlist entry says 1"
    );
  });

  it("fails a stale entry so the list shrinks", () => {
    expect(run([off(A)], { [A]: 2 })[0]).toContain("lower the count to 1");
    expect(run([], { [A]: 1 })[0]).toContain("delete the entry");
  });

  it("fails growth against the base allowlist", () => {
    expect(run([off(A), off(B)], { [A]: 1, [B]: 1 }, { [A]: 1 })).toEqual([
      expect.stringContaining(`${B}: new allowlist entry`),
    ]);
    expect(run([off(A), off(A)], { [A]: 2 }, { [A]: 1 })).toEqual([
      expect.stringContaining("went up from 1 to 2"),
    ]);
  });

  it("skips the growth check when the base cannot be read", () => {
    expect(run([off(B)], { [B]: 1 }, undefined)).toEqual([]);
  });

  it("fails when the oxlint override and the allowlist disagree", () => {
    expect(run([off(A)], { [A]: 1 }, undefined, [])).toEqual([
      expect.stringContaining("not in the .oxlintrc.json complexity override"),
    ]);
    expect(run([off(A)], { [A]: 1 }, undefined, [A, B])).toEqual([
      expect.stringContaining(
        `${B}: in the .oxlintrc.json complexity override`
      ),
    ]);
  });
});

describe("readRuleConfig", () => {
  it("reads the threshold, the legacy override and the test globs from JSONC", () => {
    const config = readRuleConfig(`{
      // a comment
      "ignorePatterns": ["**/dist/**"],
      "rules": { "complexity": ["error", { "max": 15, "variant": "modified" }] },
      "overrides": [
        { "files": ["**/*.test.ts"], "rules": { "complexity": "off" } },
        { "files": ["${A}"], "rules": { "complexity": "off" } },
        { "files": ["${B}"], "rules": { "no-console": "off" } }
      ]
    }`);
    expect(config).toEqual({
      max: 15,
      variant: "modified",
      ignorePatterns: ["**/dist/**"],
      overrideFiles: [A],
      offPatterns: ["**/*.test.ts"],
    });
  });
});

describe("findDisableComments", () => {
  it("finds eslint- and oxlint-disable comments that name complexity", () => {
    const disable = "disable-next-line";
    const src = [
      `// eslint-${disable} complexity`,
      "const a = 1;",
      `/* oxlint-disable complexity, no-console */`,
      `// eslint-${disable} no-console`,
    ].join("\n");
    expect(findDisableComments(A, src)).toEqual([`${A}:1`, `${A}:3`]);
  });
});
