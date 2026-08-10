import { NEWSLETTER_GREETING_SIGIL } from "@/features/article-writer/lint-rules";
import { getImageInstructions } from "./image-instructions";
import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { SCREENSHOT_INSTRUCTIONS } from "./screenshot-instructions";
import { getTranscriptSection } from "./transcript-instructions";

export const generateNewsletterPrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  images: string[];
  courseStructure?: string;
  links: GlobalLink[];
  aiHeroUrl?: string;
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
You are writing a newsletter for the AI Hero audience. This newsletter is a preview/teaser of the actual article, giving readers just a taste of what they'll discover inside.

The purpose is to entice readers to click through and read the full article.
</role-context>

<documents>
${transcriptSection}${courseStructureSection}${codeSection}</documents>

<the-ask>
Write a friendly, informal newsletter preview for this coding lesson.

The newsletter should:
- Start with exactly this greeting: ${NEWSLETTER_GREETING_SIGIL}
- Be written in a friendly style (informal but not stupid)
- Be relatively short - a few paragraphs at most
- Give readers a taste of what's to come
- Tease the key insights without giving everything away
- Make readers curious to read the full article
- Feel free to use images, especially diagrams
- Sign off with: "Matt"
${opts.aiHeroUrl ? `- Include a call-to-action linking readers to the full article at ${opts.aiHeroUrl}` : ""}
${getImageInstructions(opts.images)}

${SCREENSHOT_INSTRUCTIONS}

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the newsletter.

Respond ONLY with the newsletter content in markdown format. Do not include any other text or explanations.

The newsletter should be engaging and conversational, ending with the signature "Matt" on its own line.
</output-format>
`.trim();
};
