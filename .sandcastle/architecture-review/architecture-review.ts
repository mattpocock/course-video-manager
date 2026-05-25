import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { runWithExtraction } from "../run-with-extraction";

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const PromptOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("proposed"),
    title: z.string().min(1).max(256),
    body: z.string().min(1),
    oneLineSummary: z.string().min(1),
    candidatesConsidered: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    status: z.literal("skipped"),
    reason: z.string().min(1),
  }),
]);

const result = await runWithExtraction({
  name: `architecture-review-${new Date().toISOString().slice(0, 10)}`,
  agent: sandcastle.claudeCode("claude-opus-4-6", {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
    },
  }),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  output: sandcastle.Output.object({
    tag: "output",
    schema: PromptOutput,
  }),
  extractionPrompt: fs.readFileSync(
    path.join(import.meta.dirname, "extraction.md"),
    "utf8"
  ),
});

fs.writeFileSync(
  path.join(OUTPUT_DIR, "architecture_review_output.json"),
  JSON.stringify(result.output, null, 2)
);

if (result.output.status === "proposed") {
  fs.writeFileSync(path.join(OUTPUT_DIR, "prd_title.txt"), result.output.title);
  fs.writeFileSync(path.join(OUTPUT_DIR, "prd_body.md"), result.output.body);
  console.log(`\nProposed PRD: ${result.output.title}`);
  console.log(
    `  candidates considered: ${result.output.candidatesConsidered.length}`
  );
  console.log(`  body written to ${OUTPUT_DIR}/prd_body.md`);
} else {
  console.log(`\nSkipped — no fresh candidates.`);
  console.log(`  reason: ${result.output.reason}`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}
