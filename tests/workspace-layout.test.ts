import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The monorepo's shape, asserted from the outside.
 *
 * Vercel builds one project per deployable directory and works out what to
 * deploy from the workspace dependency graph. That graph only exists if every
 * package carries a unique `name` and names the packages it depends on — a
 * package that reaches into a sibling's files through a path alias without
 * declaring the dependency is invisible to the graph, and Vercel then either
 * skips a build it needed or runs one it did not.
 *
 * `tests/` sits at the workspace root, so the root is one level up.
 */
const REPO_ROOT = join(import.meta.dirname, "..");

const WORKSPACE_PACKAGES = [
  "apps/local",
  "apps/remote",
  "packages/core",
  "packages/overlay-renderer",
] as const;

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const readPackageJson = (dir: string): PackageJson =>
  JSON.parse(readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8"));

describe("workspace layout", () => {
  it("gives every workspace package a unique name", () => {
    const names = WORKSPACE_PACKAGES.map((dir) => readPackageJson(dir).name);

    expect(names.every((name) => typeof name === "string" && name !== "")).toBe(
      true
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("has apps/local declare its dependency on the core package", () => {
    const local = readPackageJson("apps/local");
    const core = readPackageJson("packages/core");

    const declared = {
      ...local.dependencies,
      ...local.devDependencies,
    };

    expect(declared[core.name!]).toBe("workspace:*");
  });

  it("has apps/remote declare its dependency on the core package", () => {
    const remote = readPackageJson("apps/remote");
    const core = readPackageJson("packages/core");

    const declared = {
      ...remote.dependencies,
      ...remote.devDependencies,
    };

    expect(declared[core.name!]).toBe("workspace:*");
  });

  it("has apps/local declare the remote app it derives its CLI client from", () => {
    // The CLI's HTTP client is typed from `RemoteApp`. Reaching into a sibling
    // through a path alias without declaring the dependency would leave the
    // edge invisible to Vercel's graph.
    const local = readPackageJson("apps/local");
    const remote = readPackageJson("apps/remote");

    const declared = {
      ...local.dependencies,
      ...local.devDependencies,
    };

    expect(declared[remote.name!]).toBe("workspace:*");
  });

  it("keeps apps/remote free of any dependency on apps/local", () => {
    // The deployed app must never be able to reach ffmpeg, OBS or the finished
    // videos directory. `packages/core` is the only thing the two share.
    const remote = readPackageJson("apps/remote");
    const declared = Object.keys({
      ...remote.dependencies,
      ...remote.devDependencies,
    });

    expect(declared.filter((name) => name.startsWith("@cvm/local"))).toEqual(
      []
    );
  });

  it("keeps the core package free of dependencies on the apps", () => {
    const core = readPackageJson("packages/core");
    const declared = Object.keys({
      ...core.dependencies,
      ...core.devDependencies,
    });

    expect(declared.filter((name) => name.startsWith("@cvm/local"))).toEqual(
      []
    );
  });
});
