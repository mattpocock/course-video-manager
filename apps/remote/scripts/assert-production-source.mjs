// Fails the Vercel build when a production deployment did not come from
// GitHub's `main`, so `vercel deploy --prod` from a worktree or a dirty
// checkout cannot ship unmerged code. Preview builds are untouched. The rules
// live in production-source.mjs.
//
// Plain .mjs for the same reason as migrate-on-deploy.mjs: it runs on
// whatever Node the build image has, and the app never imports it.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decideProductionSource } from "./production-source.mjs";

const readCheckoutHead = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const decision = decideProductionSource({
  vercelEnv: process.env.VERCEL_ENV,
  gitProvider: process.env.VERCEL_GIT_PROVIDER,
  commitRef: process.env.VERCEL_GIT_COMMIT_REF,
  commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
  checkoutHead:
    process.env.VERCEL_ENV === "production" ? readCheckoutHead() : null,
});

if (!decision.ok) {
  console.error(`\nassert-production-source: ${decision.reason}\n`);
  process.exit(1);
}
console.log(`assert-production-source: ${decision.reason}`);
