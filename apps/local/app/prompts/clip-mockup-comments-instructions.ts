/**
 * The author's Clip Mockup Comments, as a system-prompt section. How much
 * weight they carry is the source hierarchy's call, not this section's.
 */
export const getClipMockupCommentsSection = (comments: string): string => {
  if (!comments.trim()) return "";

  return `\n\n## Author's Comments\n\nThe following are the author's comments on the video. Each one sits under the Animatic clip line or chapter it is about. Use them as the source hierarchy says: a comment about the written output is an instruction to follow, a comment about the take is a plan the transcript confirms or overrules, and no comment is ever quoted as words said on camera:\n\n<comments>\n${comments}\n</comments>`;
};
