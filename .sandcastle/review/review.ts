import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { z } from "zod";
import * as sandcastle from "@ai-hero/sandcastle";
import { parseDiffLines } from "./parse-diff-lines";
import { ReviewOutput } from "./review-output";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

const PR_NUMBER = required("PR_NUMBER");
const BRANCH = required("BRANCH");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const PrView = z.object({
  title: z.string(),
  body: z.string().nullable().default(""),
  headRefOid: z.string(),
  comments: z.array(
    z.object({
      id: z.string().optional(),
      author: z.object({ login: z.string() }).nullable().optional(),
      body: z.string(),
      createdAt: z.string().optional(),
    })
  ),
});

const prViewJson = sh(
  `gh pr view ${PR_NUMBER} --json title,body,headRefOid,comments`
);
const prView = PrView.parse(JSON.parse(prViewJson));

const issueMatch = prView.body?.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
const ISSUE_NUMBER = issueMatch?.[1] ?? "";
const ISSUE_TITLE = ISSUE_NUMBER
  ? safeSh(`gh issue view ${ISSUE_NUMBER} --json title --jq .title`).trim()
  : "";

const reviewsJson = sh(
  `gh api repos/{owner}/{repo}/pulls/${PR_NUMBER}/reviews`
);
const reviews = z
  .array(
    z.object({
      id: z.number(),
      user: z.object({ login: z.string() }).nullable(),
      body: z.string().nullable().default(""),
      state: z.string(),
      submitted_at: z.string().nullable().optional(),
    })
  )
  .parse(JSON.parse(reviewsJson));

const graphqlQuery = `
query($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner,name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first:50) {
            nodes {
              id
              path
              line
              originalLine
              body
              author { login }
            }
          }
        }
      }
    }
  }
}`;

const [owner, repo] = required("GH_REPO").split("/");
const threadsJson = execFileSync(
  "gh",
  [
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${repo}`,
    "-F",
    `number=${PR_NUMBER}`,
    "-f",
    `query=${graphqlQuery}`,
  ],
  { encoding: "utf8" }
);
const threadsParsed = z
  .object({
    data: z.object({
      repository: z.object({
        pullRequest: z.object({
          reviewThreads: z.object({
            nodes: z.array(
              z.object({
                id: z.string(),
                isResolved: z.boolean(),
                isOutdated: z.boolean(),
                comments: z.object({
                  nodes: z.array(
                    z.object({
                      id: z.string(),
                      path: z.string().nullable(),
                      line: z.number().nullable(),
                      originalLine: z.number().nullable(),
                      body: z.string(),
                      author: z.object({ login: z.string() }).nullable(),
                    })
                  ),
                }),
              })
            ),
          }),
        }),
      }),
    }),
  })
  .parse(JSON.parse(threadsJson));

const unresolvedThreads =
  threadsParsed.data.repository.pullRequest.reviewThreads.nodes.filter(
    (t) => !t.isResolved
  );

const prComments = {
  issue_comments: prView.comments.map((c) => ({
    author: c.author?.login ?? "unknown",
    body: c.body,
    createdAt: c.createdAt,
  })),
  review_summaries: reviews
    .filter((r) => r.body && r.body.trim().length > 0)
    .map((r) => ({
      author: r.user?.login ?? "unknown",
      state: r.state,
      body: r.body,
      submittedAt: r.submitted_at,
    })),
  review_threads: unresolvedThreads.flatMap((t) =>
    t.comments.nodes.map((c) => ({
      commentId: c.id,
      threadId: t.id,
      path: c.path,
      line: c.line ?? c.originalLine,
      author: c.author?.login ?? "unknown",
      body: c.body,
    }))
  ),
};

const result = await sandcastle.run({
  name: `review-pr-${PR_NUMBER}`,
  agent: sandcastle.claudeCode("claude-opus-4-6", {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
    },
  }),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  promptArgs: {
    PR_NUMBER,
    BRANCH,
    ISSUE_NUMBER: ISSUE_NUMBER || "(none)",
    ISSUE_TITLE: ISSUE_TITLE || "(no linked issue)",
    PR_COMMENTS_JSON: JSON.stringify(prComments, null, 2),
  },
  output: sandcastle.Output.object({
    tag: "output",
    schema: ReviewOutput,
  }),
});

const verdict = result.commits.length > 0 ? "improved" : "clean";

const headSha = sh("git rev-parse HEAD").trim();
const diffLines = parseDiffLines(safeSh("git diff main...HEAD"));
const validInlineComments = result.output.inlineComments.filter((c) => {
  const fileLines = diffLines.get(c.path);
  if (!fileLines) {
    console.warn(
      `Dropping inline comment for ${c.path}:${c.line} — file not in diff.`
    );
    return false;
  }
  if (!fileLines.has(c.line)) {
    console.warn(
      `Dropping inline comment for ${c.path}:${c.line} — line not in diff hunks.`
    );
    return false;
  }
  return true;
});

const validReplyIds = new Set(
  prComments.review_threads.map((c) => c.commentId)
);
const validReplies = result.output.replies.filter((r) => {
  if (!validReplyIds.has(r.commentId)) {
    console.warn(
      `Dropping reply for commentId=${r.commentId} — not in fetched threads.`
    );
    return false;
  }
  return true;
});

const reviewPayload = {
  commit_id: headSha,
  event: "COMMENT" as const,
  body: result.output.summary,
  comments: validInlineComments.map((c) => ({
    path: c.path,
    line: c.line,
    side: "RIGHT" as const,
    body: c.body,
  })),
};

fs.writeFileSync(
  path.join(OUTPUT_DIR, "review_payload.json"),
  JSON.stringify(reviewPayload, null, 2)
);
fs.writeFileSync(
  path.join(OUTPUT_DIR, "replies.json"),
  JSON.stringify(validReplies, null, 2)
);
fs.writeFileSync(path.join(OUTPUT_DIR, "summary.md"), result.output.summary);
fs.writeFileSync(path.join(OUTPUT_DIR, "verdict.txt"), verdict);

console.log(`\nReview complete.`);
console.log(`  verdict: ${verdict}`);
console.log(`  commits: ${result.commits.length}`);
console.log(`  inline comments: ${validInlineComments.length}`);
console.log(`  replies: ${validReplies.length}`);

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function safeSh(cmd: string): string {
  try {
    return sh(cmd);
  } catch {
    return "";
  }
}

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
