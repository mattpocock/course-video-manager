export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export type BumpLevel = "major" | "minor" | "patch";

export const ZERO_SEMVER: Semver = { major: 0, minor: 0, patch: 0 };

const SEMVER_RE = /^[vV]?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(input: string): Semver | null {
  const m = SEMVER_RE.exec(input);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatSemver(v: Semver): string {
  return `v${v.major}.${v.minor}.${v.patch}`;
}

export function bumpSemver(v: Semver, level: BumpLevel): Semver {
  switch (level) {
    case "major":
      return { major: v.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: v.major, minor: v.minor + 1, patch: 0 };
    case "patch":
      return { major: v.major, minor: v.minor, patch: v.patch + 1 };
  }
}
