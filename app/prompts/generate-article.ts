import { getImageInstructions } from "./image-instructions";
import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { SCREENSHOT_INSTRUCTIONS } from "./screenshot-instructions";
import { CODE_SAMPLES, STYLE_GUIDE_BASE } from "./style-guide";

const taskInstructions = `
${STYLE_GUIDE_BASE}

${CODE_SAMPLES}

### Problem vs Solution Code

If the transcript appears to be discussing only the problem section, do not refer to the solution section code - but DO use code samples from the problem section.

When discussing the problem, use problem code samples only.
`.trim();

export const generateArticlePrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  images: string[];
  sectionNames?: string[];
  courseStructure?: string;
  links: GlobalLink[];
}) => {
  const transcriptSection = opts.transcript
    ? `Here is the transcript of the video:

<transcript>
${opts.transcript}
</transcript>

Some clips are annotated with a «on screen: …» marker directly after their [N] index. This means those web pages were visible on screen during that part of the video. Treat them as context, not narration — do not read the marker out as prose. Where it genuinely helps the reader, you may link to those URLs at the relevant point. Each page is annotated only once, at its first appearance.

`
    : "";

  const sectionNamesSection =
    opts.sectionNames && opts.sectionNames.length > 0
      ? `The video has been organized into the following sections:

${opts.sectionNames.map((name) => `- ${name}`).join("\n")}

Use these section names as inspiration for your own section headings. You should choose headings that best fit the content and flow of the article, rather than sticking exactly to these names.

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
You are a helpful assistant being asked to format a transcript of a video to accompany it for easier reading. The video is a screencast from a coding lesson, where the viewer can see the code.

## Documents

${transcriptSection}${sectionNamesSection}${courseStructureSection}Here is the code for the video.

<code>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>

## Task Instructions

${taskInstructions}

${getImageInstructions(opts.images)}

${getLinkInstructions(opts.links)}

${SCREENSHOT_INSTRUCTIONS}

## IMPORTANT INSTRUCTIONS

Create an annotated version of the transcript, with the code samples and other relevant information.

Stick extremely closely to the transcript. Fix any obvious typos or transcription mistakes.

Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the article.

Respond only with the annotated transcript. Do not include any other text.
`;
};
