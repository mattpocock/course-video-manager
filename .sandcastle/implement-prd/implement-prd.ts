import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

const PRD_NUMBER = required("PRD_NUMBER");
const PRD_TITLE = required("PRD_TITLE");
const SUB_ISSUE_NUMBER = required("SUB_ISSUE_NUMBER");
const SUB_ISSUE_TITLE = required("SUB_ISSUE_TITLE");
const BRANCH = required("BRANCH");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const PromptOutput = z.object({
  prTitle: z.string().min(1).max(256),
  prDescription: z.string().min(1),
});

const result = await sandcastle.run({
  name: `implement-prd-#${PRD_NUMBER}-sub-#${SUB_ISSUE_NUMBER}`,
  agent: sandcastle.claudeCode("claude-opus-4-6", {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
    },
  }),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  promptArgs: {
    PRD_NUMBER,
    PRD_TITLE,
    SUB_ISSUE_NUMBER,
    SUB_ISSUE_TITLE,
    BRANCH,
  },
  output: sandcastle.Output.object({
    tag: "output",
    schema: PromptOutput,
  }),
});

// No "did this produce commits?" check: a sub-issue's work may already have
// been completed by a previous iteration, in which case the agent legitimately
// produces zero new commits and we still want the workflow to proceed (close
// the sub-issue, advance to the next one).

fs.writeFileSync(path.join(OUTPUT_DIR, "pr_title.txt"), result.output.prTitle);
fs.writeFileSync(
  path.join(OUTPUT_DIR, "pr_description.txt"),
  result.output.prDescription
);

console.log(`\nWrote PR metadata to ${OUTPUT_DIR}`);
console.log(`  title: ${result.output.prTitle}`);
console.log(`  commits this run: ${result.commits.length}`);

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}
