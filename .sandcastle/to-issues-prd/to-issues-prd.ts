import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { z } from "zod";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

const PRD_NUMBER = required("PRD_NUMBER");
const PRD_TITLE = required("PRD_TITLE");
const GH_REPO = required("GH_REPO");

const Slice = z.object({
  title: z.string().min(1).max(200),
  whatToBuild: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
});

const PromptOutput = z.object({
  slices: z.array(Slice).min(1),
});

const result = await sandcastle.run({
  name: `to-issues-prd-#${PRD_NUMBER}`,
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
  },
  output: sandcastle.Output.object({
    tag: "output",
    schema: PromptOutput,
  }),
});

const slices = result.output.slices;
const createdNumbers: number[] = [];

for (let i = 0; i < slices.length; i++) {
  const slice = slices[i]!;
  const position = i + 1;

  const body = renderBody({
    prdNumber: Number(PRD_NUMBER),
    whatToBuild: slice.whatToBuild,
    acceptanceCriteria: slice.acceptanceCriteria,
  });

  let createOutput: string;
  try {
    createOutput = execFileSync(
      "gh",
      ["issue", "create", "--title", slice.title, "--body", body],
      { encoding: "utf8" }
    ).trim();
  } catch (err) {
    console.error(
      `Failed to create sub-issue at position ${position} ("${slice.title}").`
    );
    console.error(
      `Created so far: ${createdNumbers.map((n) => `#${n}`).join(", ") || "(none)"}`
    );
    throw err;
  }

  const urlMatch = createOutput.match(/\/issues\/(\d+)\s*$/);
  if (!urlMatch) {
    console.error(
      `Could not parse issue number from \`gh issue create\` output: ${createOutput}`
    );
    process.exit(1);
  }
  const subIssueNumber = Number(urlMatch[1]);
  createdNumbers.push(subIssueNumber);

  const subIssueId = execFileSync(
    "gh",
    ["api", `repos/${GH_REPO}/issues/${subIssueNumber}`, "--jq", ".id"],
    { encoding: "utf8" }
  ).trim();

  execFileSync(
    "gh",
    [
      "api",
      "-X",
      "POST",
      `repos/${GH_REPO}/issues/${PRD_NUMBER}/sub_issues`,
      "-f",
      `sub_issue_id=${subIssueId}`,
    ],
    { encoding: "utf8" }
  );

  console.log(
    `  [${position}/${slices.length}] created #${subIssueNumber} — ${slice.title}`
  );
}

console.log(
  `\nAttached ${createdNumbers.length} sub-issue(s) to PRD #${PRD_NUMBER}.`
);

function renderBody(opts: {
  prdNumber: number;
  whatToBuild: string;
  acceptanceCriteria: string[];
}): string {
  const criteria = opts.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");
  return `## Parent PRD

#${opts.prdNumber}

## What to build

${opts.whatToBuild}

## Acceptance criteria

${criteria}
`;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}
