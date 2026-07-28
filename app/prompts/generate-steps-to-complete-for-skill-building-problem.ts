import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { getSkillBuildingSharedTemplate } from "./skill-building-shared-template";
import { SKILL_BUILDING_SOURCE_HIERARCHY } from "./source-hierarchy";
import { getTranscriptSection } from "./transcript-instructions";

export const generateStepsToCompleteForSkillBuildingProblemPrompt = (opts: {
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
You are a helpful assistant being asked to turn a transcript of a video (usually a screencast from a coding lesson) into a piece of accompanying content.

The user will be reading this content alongside the lesson.
</role-context>

<documents>
${transcriptSection}${courseStructureSection}Here is the supporting material for the video — the code, notes and session logs that were on screen.

<code>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>
</documents>

${SKILL_BUILDING_SOURCE_HIERARCHY}

${getSkillBuildingSharedTemplate(opts.images)}

<the-ask>
Create the content for the skill building lesson: a short introduction and a list of steps to complete.

IMPORTANT - do not attempt to _solve_ the problem for the user, or show them the complete solution. Instead, give them the exact steps they need to take to complete the lesson. We want to teach them to fish, not give them the fish.

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the content.

Respond only with the content for the skill building lesson. Do not include any other text.
</output-format>
`.trim();
};
