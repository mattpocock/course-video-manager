import { getImageInstructions } from "./image-instructions";
import { CODE_SAMPLES, STYLE_GUIDE } from "./style-guide";

const taskInstructions = `
${STYLE_GUIDE}

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
}) => `
You are a helpful assistant being asked to format a transcript of a video to accompany it for easier reading. The video is a screencast from a coding lesson, where the viewer can see the code.

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

## Task Instructions

${taskInstructions}

${getImageInstructions(opts.images)}

## IMPORTANT INSTRUCTIONS

Create an annotated version of the transcript, with the code samples and other relevant information.

Stick extremely closely to the transcript. Fix any obvious typos or transcription mistakes.

Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the article.

Respond only with the annotated transcript. Do not include any other text.
`;
