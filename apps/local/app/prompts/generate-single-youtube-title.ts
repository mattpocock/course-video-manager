import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { getTranscriptSection } from "./transcript-instructions";

export const generateSingleYoutubeTitlePrompt = (opts: {
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

  const codeSection =
    opts.code.length > 0
      ? `Here is the code for the video:

<code>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>

`
      : "";

  const courseStructureSection = opts.courseStructure
    ? `This lesson is part of a larger course. Here is the full structure:

<course-structure>
${opts.courseStructure}
</course-structure>

`
    : "";

  return `
<role-context>
You are a helpful assistant being asked to generate a compelling YouTube title for a coding lesson video.

YouTube titles should be attention-grabbing, clickable, and clearly communicate the value or hook of the video.
</role-context>

<documents>
${transcriptSection}${courseStructureSection}${codeSection}</documents>

<the-ask>
Generate a single engaging YouTube title for this coding lesson.

The title should:
- Be compelling and encourage clicks
- Clearly indicate what the viewer will learn or discover
- Use conversational, engaging language
- Use sentence case (capitalize only the first word and proper nouns)
- Be concise (aim for 60-70 characters for optimal display)

Pick the most effective framing device for the content. Options include:
- Problem-focused: "Stop writing the same API boilerplate in every project"
- Practical outcome: "Build a full-stack app in 30 minutes with this pattern"
- Curiosity/mystery: "The React hook that changed how I think about state"
- Contrarian: "Why you shouldn't always use async/await"
- Question format: "Why are your TypeScript types so complicated?"
- Direct command: "Write better tests without mocking everything"
- Social proof: "Most developers don't know JavaScript has this feature"

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Respond with ONLY the title text. No numbering, no quotes, no explanation. Just the title.
</output-format>
`.trim();
};
