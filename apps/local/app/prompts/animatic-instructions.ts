/**
 * The Video's Animatic, as a system-prompt section. How much weight it and
 * its comments carry is the source hierarchy's call; this section only says
 * how to read the block.
 *
 * One exception: with no transcript the video has not been filmed, and the
 * hierarchy's "the transcript sets the scope" would leave nothing to write.
 * Then the Animatic takes the transcript's place, so an article can be
 * drafted from it before filming (issue #2510). A filmed video's section is
 * unchanged, which keeps its cached prompt prefix stable.
 */
export const getAnimaticSection = (
  animatic: string,
  transcript: string
): string => {
  if (!animatic.trim()) return "";

  const block = `<animatic>\n${animatic}\n</animatic>`;

  if (!transcript.trim()) {
    return `\n\n## Animatic (the video has not been filmed yet)\n\nThe following is the video's Animatic — the mock the author made before filming. Each "Mockup N" is one planned moment: a still image that is to be on screen (not included here) and the line to be said over it. "Chapter:" lines are dividers grouping the moments below them. Lines starting "Comment:" are the author's own notes, each about the mockup or chapter above it.\n\nThere is no transcript: the video has not been filmed, and the author wants a first draft of the written output to test the idea before filming. For this draft the Animatic takes the transcript's place on the source hierarchy, and this overrides every instruction above that assumes a transcript. The mockup lines set the scope and the order: wherever the instructions say "transcript", read the Animatic's mockup lines, and make no claim they do not make. Turn them into readable prose, not a list of moments. A comment about the written output is an instruction to follow; a comment about the take is a plan. A mockup line is planned speech, not words said on camera, so never present it as a quote from the video. There are no clips yet, so never insert a ChooseScreenshot component and never use a mockup number as a clipIndex:\n\n${block}`;
  }

  return `\n\n## Animatic\n\nThe following is the video's Animatic — the mock the author watched before filming. Each "Mockup N" is one planned moment: a still image that was to be on screen (not included here) and the line to be said over it. "Chapter:" lines are dividers grouping the moments below them. Mockup numbers are NOT transcript clip indices — never use one as a clipIndex. Lines starting "Comment:" are the author's own notes, each about the mockup or chapter above it. Use the Animatic as the source hierarchy says: the mockup lines are a plan the transcript confirms or overrules; a comment about the written output is an instruction to follow; a comment about the take is a plan; and no mockup line or comment is ever quoted as words said on camera:\n\n${block}`;
};
