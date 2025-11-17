import { CODE_SAMPLES, STYLE_GUIDE } from "./style-guide";
import { STEPS_TO_COMPLETE } from "./steps-to-complete";

export const generateStepsToCompleteForProjectPrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
}) => `
<role-context>
You are a helpful assistant being asked to turn a transcript of a video (a screencast from a coding lesson) into a list of steps to recreate the work done in the video. The user will be following these steps to complete the lesson.
</role-context>

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

${STYLE_GUIDE}

${CODE_SAMPLES}

<rules>
${STEPS_TO_COMPLETE}

Use copious code samples.
</rules>

<the-ask>
The transcript is a screencast displaying the work done in a single git commit as part of a larger project build.

Create a list of steps to complete to recreate the work done in the video.
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the article.

Respond only with the list of steps to complete. Do not include any other text.
</output-format>
`.trim();
