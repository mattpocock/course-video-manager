import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

const ISSUE_NUMBER = required("ISSUE_NUMBER");
const ISSUE_TITLE = required("ISSUE_TITLE");
const BRANCH = required("BRANCH");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const result = await sandcastle.run({
  name: `implement-#${ISSUE_NUMBER}`,
  agent: sandcastle.claudeCode("claude-opus-5", {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
    },
  }),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  promptArgs: {
    ISSUE_NUMBER,
    ISSUE_TITLE,
    BRANCH,
  },
});

const commitsAhead = Number(
  execSync("git rev-list --count main..HEAD", { encoding: "utf8" }).trim()
);
if (!Number.isFinite(commitsAhead) || commitsAhead === 0) {
  fail("Agent finished but no commits were made on the branch.");
}

console.log(
  `\nImplementation produced ${commitsAhead} commit(s) on ${BRANCH}.`
);
console.log(`  commits this run: ${result.commits.length}`);

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function fail(message: string): never {
  console.error(`\nFAILED: ${message}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "failure_reason.txt"), message);
  process.exit(1);
}
