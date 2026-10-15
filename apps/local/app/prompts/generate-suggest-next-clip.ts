/**
 * The prompt behind the Video Editor's **Suggestions** tab: what should the
 * author say in the next **Clip**?
 *
 * The guide is the **Script** or the **Animatic** (whichever sources the author
 * ticked); the **Beats** say what each part of the Video is for. "Where the
 * author is" is read from the transcripts of the most recent Clips, matched
 * against that guide. Every source is optional: an unticked or missing one is
 * simply left out. The author's **Notes** for this Video outrank the rest:
 * they say how today's take departs from the plan.
 */
export type SuggestNextClipInput = {
  notes?: string;
  script?: string;
  animatic?: string;
  beats?: string;
  /** Transcripts of the most recent Clips, oldest first. */
  recentClips: string[];
};

const section = (tag: string, intro: string, body: string | undefined) =>
  body && body.trim().length > 0
    ? `${intro}\n\n<${tag}>\n${body.trim()}\n</${tag}>`
    : "";

export const generateSuggestNextClipPrompt = (
  input: SuggestNextClipInput
): string => {
  const guides = [
    section(
      "notes",
      "The creator's own notes for this video. They take PRIORITY over everything below: where they conflict with the Script, the Animatic or the Beats, follow the notes.",
      input.notes
    ),
    section(
      "script",
      "The Script: the planned words for this video, read off a teleprompter.",
      input.script
    ),
    section(
      "animatic",
      "The Animatic: the planned moments of this video, one spoken line per Mockup, grouped under chapters. Each Mockup is roughly one clip.",
      input.animatic
    ),
    section(
      "beats",
      "The Beats: what each part of the video does for the viewer.",
      input.beats
    ),
  ].filter(Boolean);

  const recent =
    input.recentClips.length > 0
      ? `The most recent clips the creator has recorded, oldest first. This is where they are right now.

<recent-clips>
${input.recentClips.map((text, i) => `Clip ${i + 1}: ${text}`).join("\n")}
</recent-clips>`
      : "The creator has not recorded anything yet: suggest the opening line of the video.";

  return `
<role-context>
You are a teleprompter for a course creator recording a video one short clip at a time. After each clip, you show them what to say next.
</role-context>

${guides.length > 0 ? guides.join("\n\n") : "There is no plan for this video: continue naturally from the recent clips."}

${recent}

<the-ask>
Work out where the most recent clips sit in the plan, then write the very next thing the creator should say.

- Follow the plan: the Script or the Animatic is the guide for what comes next.
- If there are notes, they override the plan wherever the two disagree.
- Do not repeat anything the creator has already recorded. Skip what the recent clips already cover.
- Keep it short: one clip's worth, one or two sentences at most.
- Write it in the creator's own voice, as heard in the recent clips: conversational, natural when read aloud.
</the-ask>

<output-format>
Output ONLY the spoken words. No quotes, no "you should say...", no stage directions, no markdown.
</output-format>
`.trim();
};
