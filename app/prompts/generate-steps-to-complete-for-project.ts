import { getImageInstructions } from "./image-instructions";
import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { PROJECT_STYLE_GUIDE } from "./project-style-guide";
import PROJECT_STEPS_SAMPLE from "./project-steps-sample.md?raw";
import { PROJECT_SOURCE_HIERARCHY } from "./source-hierarchy";
import { getTranscriptSection } from "./transcript-instructions";

export const generateStepsToCompleteForProjectPrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  images: string[];
  courseStructure?: string;
  links: GlobalLink[];
}) => {
  const transcriptSection = getTranscriptSection(opts.transcript);

  const courseStructureSection = opts.courseStructure
    ? `This lesson is part of a larger course. Here is the full structure:

<course-structure>
${opts.courseStructure}
</course-structure>

`
    : "";

  return `
<role-context>
You are a helpful assistant being asked to turn a git commit diff and video transcript into a list of steps to recreate the work done in the commit. The user will be following these steps to complete the lesson.
</role-context>

## Documents

${transcriptSection}${courseStructureSection}Here is the code for the video, which includes the git diff and commit message:

<code>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>

${PROJECT_SOURCE_HIERARCHY}

${PROJECT_STYLE_GUIDE}

${getImageInstructions(opts.images)}

<example-format>
Here is an example of the exact format to follow:

${PROJECT_STEPS_SAMPLE}
</example-format>

<rules>
- Extract the title from the commit message for the H2 heading
- H2 titles MUST use continuous verb form (present participle): "Adding" not "Added", "Removing" not "Removed", "Implementing" not "Implemented" - titles describe ongoing work, not past actions
- Add markdown comment <!-- VIDEO --> immediately after H2
- Start directly with H2 (no intro section)
- Use H3 for "Steps To Complete"
- Use H4 for each substep grouping
- Show imports and commands directly (not in spoilers)
- Wrap solution code in <Spoiler> tags
- Use checkbox format: - [ ] description
- Be extremely concise
- Include brief (1-2 sentence) explanations of WHY changes are made when reasoning isn't obvious from context
- Annotate code changes with comments (ADDED, CHANGED, DELETED) on specific lines to describe syntactic changes (e.g., "ADDED: Sort by score", "CHANGED: Map from emailsWithScores instead of allEmails")
- Focus on the diff to understand what changed
- Use copious code samples
- Each code sample MUST have a comment at the top indicating the file path being changed

Example:
\`\`\`typescript
// src/app/search.ts
export function searchWithBM25() {
  // ...
}
\`\`\`
</rules>

<the-ask>
Create a list of steps to complete to recreate the work done in the commit.

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the output.

Respond only with the markdown steps. Do not include any other text.
</output-format>
`.trim();
};
