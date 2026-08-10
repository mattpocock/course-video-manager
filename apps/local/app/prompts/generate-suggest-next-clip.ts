export type FewShotExample = {
  clipTranscripts: string[];
};

const formatFewShotExample = (example: FewShotExample): string => {
  if (example.clipTranscripts.length < 2) {
    return "";
  }

  const contextClips = example.clipTranscripts;

  const transcriptLines = contextClips
    .map((text, i) => `Clip ${i + 1}: ${text}`)
    .join("\n");

  return `<example-transcript>
${transcriptLines}
</example-transcript>`;
};

export const generateSuggestNextClipPrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  fewShotExamples?: FewShotExample[];
}) => {
  const transcriptSection = opts.transcript
    ? `Here is the full transcript of the video so far, broken into clips.

<transcript>
${opts.transcript}
</transcript>

`
    : "";

  const documentsSection =
    opts.code.length > 0
      ? `Here are some accompanying documents that help give context to what the video is about.

<document>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</document>

`
      : "";

  const fewShotSection =
    opts.fewShotExamples && opts.fewShotExamples.length > 0
      ? `<examples>
Here are examples from real recordings showing the clip-by-clip flow. Use these for inspiration on clip length and format.

${opts.fewShotExamples.map(formatFewShotExample).filter(Boolean).join("\n\n")}
</examples>`
      : "";

  return `
<role-context>
You are a helpful assistant for a course creator who is recording video lessons clip-by-clip.

After each clip is recorded and transcribed, you suggest what the creator should say next. Your suggestions should read like a teleprompter script - the exact words someone would speak aloud.
</role-context>

${documentsSection}

${transcriptSection}

${fewShotSection}

<the-ask>
Based on the transcript so far, suggest what the course creator should say in their next clip.

Your suggestion should:
- Continue naturally from where the last clip ended
- Sound conversational and natural when read aloud
- Progress the lesson logically
- The clip should match the length of the clips from the examples (REALLY short - once sentence max)
- Reference specific code if appropriate

If there is no transcript, provide a suggestion for the first clip in the video.
</the-ask>

<output-format>
Output ONLY the spoken words. No quotes, no "you should say...", no stage directions, no markdown formatting.

Just the raw script text as if reading from a teleprompter.
</output-format>
`.trim();
};
