import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const HASH_FILE = join(ROOT, "build", ".build-hash");
const SERVER_ENTRY = join(ROOT, "build", "server", "index.js");

function listFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }
  );
  return out
    .toString("utf8")
    .split("\0")
    .filter((p) => p.length > 0)
    .sort();
}

function computeHash(files: string[]): string {
  const top = createHash("sha256");
  for (const path of files) {
    const abs = join(ROOT, path);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const fileHash = createHash("sha256")
      .update(readFileSync(abs))
      .digest("hex");
    top.update(`${path}\0${fileHash}\n`);
  }
  return top.digest("hex");
}

const files = listFiles();
const currentHash = computeHash(files);

if (existsSync(HASH_FILE) && existsSync(SERVER_ENTRY)) {
  const stored = readFileSync(HASH_FILE, "utf8").trim();
  if (stored === currentHash) {
    console.log("✓ build is up to date, skipping react-router build");
    process.exit(0);
  }
}

console.log("→ repo changed, running react-router build...");
const startedAt = Date.now();
execFileSync("npx", ["react-router", "build"], {
  cwd: ROOT,
  stdio: "inherit",
});
const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

writeFileSync(HASH_FILE, currentHash + "\n");

// The build's own `✓ built in Ns` is gone — vite.config.ts drops build output
// below `warn`, because the same `info` level carries the 400-line asset table.
// The duration is the one number from that table worth keeping, so it is
// printed here instead, where the log has room for it.
console.log(`✓ react-router build finished in ${elapsedSeconds}s`);
