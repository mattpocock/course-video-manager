import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { getTranscriptSection } from "./transcript-instructions";

export const generateSocialCaptionPrompt = (opts: {
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
You are a helpful assistant writing a social media caption for a coding video. The caption will be posted to both X/Twitter and LinkedIn.

Your captions should be short, punchy, and hook-style — designed to stop the scroll and make developers want to watch the video.
</role-context>

<documents>
${transcriptSection}${courseStructureSection}${codeSection}</documents>

<the-ask>
Generate a single social media caption for this coding video.

The caption should:
- Open with a strong hook (the first line must grab attention)
- Be concise — aim for 1-4 sentences total
- Use a conversational, developer-to-developer tone
- Focus on the insight, surprise, or "aha moment" from the video
- Create curiosity or challenge a common assumption
- NOT use hashtags
- NOT use emojis
- NOT include links (those are added separately)
- NOT start with "Did you know" or "Ever wondered"
- Be suitable for both X/Twitter and LinkedIn without modification

Good caption styles:
- Lead with a bold claim or hot take, then explain briefly
- Start with a specific problem developers face, then hint at the solution
- Share a surprising fact or counterintuitive insight from the video
- Use "Most developers..." or "I used to..." to create relatability

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the caption.

Respond with ONLY the caption text. No commentary, no alternatives, no meta-text. Just the caption itself.
</output-format>
`.trim();
};
