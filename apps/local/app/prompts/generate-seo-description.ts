import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { getTranscriptSection } from "./transcript-instructions";

export const generateSeoDescriptionPrompt = (opts: {
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
You are a helpful assistant being asked to generate an SEO description for a coding lesson video.

SEO descriptions appear in search engine results and should be compelling, accurate, and optimized for discovery.
</role-context>

<documents>
${transcriptSection}${courseStructureSection}${codeSection}</documents>

<the-ask>
Generate a concise SEO description (meta description) for this coding lesson.

The description should:
- Accurately summarize what the viewer will learn
- Be compelling and encourage clicks from search results
- Include relevant keywords naturally
- Be no more than 160 characters

CRITICAL: The description MUST be 160 characters or fewer. This is a hard limit.

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the description.

Respond ONLY with the SEO description text. Do not include any other text, explanations, or formatting.

The response should be a single line of plain text, 160 characters or fewer.
</output-format>
`.trim();
};
