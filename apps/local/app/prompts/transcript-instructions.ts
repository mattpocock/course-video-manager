export const getTranscriptSection = (
  transcript: string,
  preamble = "Here is the transcript of the video:"
): string => {
  if (!transcript) return "";

  return `${preamble}

<transcript>
${transcript}
</transcript>

Some clips are annotated with a «on screen: …» marker directly after their [N] index. This means those web pages were visible on screen during that part of the video. Treat them as context, not narration — do not read the marker out as prose. Where it genuinely helps the reader, you may link to those URLs at the relevant point. Each page is annotated only once, at its first appearance.

`;
};
