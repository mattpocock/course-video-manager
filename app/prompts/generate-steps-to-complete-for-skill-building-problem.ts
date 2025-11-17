import path from "node:path";
import { STEPS_TO_COMPLETE } from "./steps-to-complete";
import { CODE_SAMPLES, STYLE_GUIDE, TODO_COMMENTS } from "./style-guide";
import { readFileSync } from "node:fs";

const SKILL_BUILDING_STEPS_TO_COMPLETE_SAMPLE = readFileSync(
  path.join(import.meta.dirname, "skill-building-steps-to-complete-sample.md"),
  "utf-8"
);

export const generateStepsToCompleteForSkillBuildingProblemPrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
}) =>
  `
<role-context>
You are a helpful assistant being asked to turn a transcript of a video (usually a screencast from a coding lesson) into a list of steps to complete to solve the lesson. The user will be following these steps to complete the lesson.
</role-context>

## Documents

Here is the transcript of the video:

<transcript>
${opts.transcript}
</transcript>

Here is the code for the video.

<code>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>

Here is a sample of the steps to complete for a skill building problem:

<sample>
${SKILL_BUILDING_STEPS_TO_COMPLETE_SAMPLE}
</sample>

${STYLE_GUIDE}

${CODE_SAMPLES}

<rules>
${STEPS_TO_COMPLETE}

${TODO_COMMENTS}

The code samples include TODO comments, and the steps to complete are really an illustrated version of the TODO comments. Follow them relatively closely.

Use copious code samples.
</rules>

<the-ask>
Create a list of steps to complete to complete the skill building lesson.

IMPORTANT - do not attempt to _solve_ the problem for the user, or show them the complete solution. Instead, give them the exact steps they need to take to complete the lesson. We want to teach them to fish, not give them the fish.
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the article.

Respond only with the list of steps to complete. Do not include any other text.
</output-format>
`.trim();
