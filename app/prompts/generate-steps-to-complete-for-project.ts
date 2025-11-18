import { getImageInstructions } from "./image-instructions";
import { PROJECT_STYLE_GUIDE } from "./project-style-guide";
import fs from "fs";
import path from "path";

const PROJECT_STEPS_SAMPLE = fs.readFileSync(
  path.join(import.meta.dirname, "project-steps-sample.md"),
  "utf-8"
);

export const generateStepsToCompleteForProjectPrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  images: string[];
}) =>
  `
<role-context>
You are a helpful assistant being asked to turn a git commit diff and video transcript into a list of steps to recreate the work done in the commit. The user will be following these steps to complete the lesson.
</role-context>

## Documents

Here is the transcript of the video:

<transcript>
${opts.transcript}
</transcript>

Here is the code for the video, which includes the git diff and commit message:

<code>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>

${PROJECT_STYLE_GUIDE}

${getImageInstructions(opts.images)}

<example-format>
Here is an example of the exact format to follow:

${PROJECT_STEPS_SAMPLE}
</example-format>

<rules>
- Extract the title from the commit message for the H2 heading
- Start directly with H2 (no intro section)
- Use H3 for "Steps To Complete"
- Use H4 for each substep grouping
- Show imports and commands directly (not in spoilers)
- Wrap solution code in <Spoiler> tags
- Use checkbox format: - [ ] description
- Be extremely concise
- Focus on the diff to understand what changed
- Use copious code samples
</rules>

<the-ask>
Create a list of steps to complete to recreate the work done in the commit.
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the output.

Respond only with the markdown steps. Do not include any other text.
</output-format>
`.trim();
