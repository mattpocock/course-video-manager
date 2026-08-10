import { data } from "react-router";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Route } from "./+types/api.feedback";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const execFileAsync = promisify(execFile);

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const description = formData.get("description");
  const url = formData.get("url");

  if (typeof description !== "string" || !description.trim()) {
    throw data("Description is required", { status: 400 });
  }

  const descriptionText = description.trim();
  const body = url
    ? `${descriptionText}\n\n---\nSubmitted from: \`${url}\``
    : descriptionText;

  // Auto-generate a short title from the description using Haiku
  let title: string;
  try {
    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system:
        "Generate a short GitHub issue title (under 80 characters) from the user's feedback description. Output ONLY the title, nothing else.",
      messages: [{ role: "user", content: descriptionText }],
    });
    title = result.text.trim();
  } catch (error) {
    console.error("Failed to generate title, using fallback:", error);
    // Fallback: use the first line/sentence of the description, truncated
    title = descriptionText.split(/[.\n]/)[0]!.slice(0, 80);
  }

  try {
    await execFileAsync("gh", [
      "issue",
      "create",
      "--repo",
      "mattpocock/course-video-manager",
      "--title",
      title,
      "--body",
      body,
      "--label",
      "agent:implement",
    ]);

    // Count open issues to show in the toast
    let openIssueCount: number | null = null;
    try {
      const { stdout } = await execFileAsync("gh", [
        "issue",
        "list",
        "--repo",
        "mattpocock/course-video-manager",
        "--state",
        "open",
        "--json",
        "number",
      ]);
      const issues = JSON.parse(stdout);
      openIssueCount = issues.length;
    } catch {
      // Non-critical, just skip the count
    }

    return { success: true, openIssueCount };
  } catch (error) {
    console.error("Failed to create GitHub issue:", error);
    throw data("Failed to create GitHub issue", { status: 500 });
  }
};
