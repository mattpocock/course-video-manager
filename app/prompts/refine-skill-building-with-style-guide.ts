import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { getSkillBuildingSharedTemplate } from "./skill-building-shared-template";
import { SOURCE_HIERARCHY } from "./source-hierarchy";
import { getTranscriptSection } from "./transcript-instructions";

export const refineSkillBuildingWithStyleGuidePrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  images: string[];
  courseStructure?: string;
  links: GlobalLink[];
}) => {
  // Find the README.md file in the code context
  const readmeFile = opts.code.find((file) =>
    file.path.toLowerCase().endsWith("readme.md")
  );

  if (!readmeFile) {
    throw new Error(
      "No README.md file found in code context. Please include the README.md file you want to refine."
    );
  }

  const transcriptSection = getTranscriptSection(
    opts.transcript,
    "Here is the transcript of the video (for additional context):"
  );

  const courseStructureSection = opts.courseStructure
    ? `This lesson is part of a larger course. Here is the full structure:

<course-structure>
${opts.courseStructure}
</course-structure>

`
    : "";

  return `
<role-context>
You are a helpful assistant being asked to refine an existing skill-building lesson README to match our style guide and formatting standards.

The user has provided an existing README that needs to be polished to ensure consistency with our style guide.
</role-context>

## Documents

Here is the existing README content that needs to be refined:

<existing-readme>
${readmeFile.content}
</existing-readme>

${transcriptSection}${courseStructureSection}Here is the code for the video (for reference):

<code>
${opts.code
  .filter((file) => !file.path.toLowerCase().endsWith("readme.md"))
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>

${SOURCE_HIERARCHY}

Here is a sample of what a well-formatted skill building README looks like:

${getSkillBuildingSharedTemplate(opts.images)}

<the-ask>
Refine the existing README to match our style guide and formatting standards. Apply all the rules above, ensuring:

1. Paragraphs are short (max 240 characters)
2. Code elements use backticks
3. Code samples are used effectively
4. Steps to complete follow the checkbox format
5. TODO comments are shown in full
6. Grammar is correct (e.g., "going to" instead of "gonna")
7. Lists, code samples, and tables are used to break up text

Output the COMPLETE refined README - do not output just the changes.

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the content.

Respond only with the refined README content. Do not include any other text or explanations.
</output-format>
`.trim();
};
