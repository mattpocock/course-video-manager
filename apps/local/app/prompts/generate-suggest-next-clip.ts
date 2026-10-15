/**
 * The prompt behind the Video Editor's **Suggestions** tab: what should the
 * author say in the next **Clip**?
 *
 * The guide is the **Script** or the **Animatic** (whichever sources the author
 * ticked); the **Beats** say what each part of the Video is for. Every Clip
 * recorded so far goes in, numbered in order; the last few are set apart as
 * where the author is now, matched against that guide. Every source is optional: an unticked or missing one is
 * simply left out. The author's **Notes** for this Video outrank the rest:
 * they say how today's take departs from the plan.
 */
export type SuggestNextClipInput = {
  notes?: string;
  script?: string;
  animatic?: string;
  beats?: string;
  /** Transcripts of every Clip before the Insertion Point, oldest first. */
  clips: string[];
};

/**
 * How many of the last Clips count as "where the author is now". The
 * teleprompter shows the same ones, dimmed, above the suggestion.
 */
export const MOST_RECENT_CLIP_COUNT = 3;

const section = (tag: string, intro: string, body: string | undefined) =>
  body && body.trim().length > 0
    ? `${intro}\n\n<${tag}>\n${body.trim()}\n</${tag}>`
    : "";

/**
 * The prompt in two parts. `plan` (the role and the sources) stays the same
 * from one Clip to the next, so the route caches it; `now` (the Clips and the
 * ask) changes with every Clip and comes after it, so it never invalidates
 * that cache.
 */
export const generateSuggestNextClipPromptParts = (
  input: SuggestNextClipInput
): { plan: string; now: string } => {
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

  const numbered = input.clips.map((text, i) => `Clip ${i + 1}: ${text}`);
  const split = Math.max(0, numbered.length - MOST_RECENT_CLIP_COUNT);
  const earlier = numbered.slice(0, split);
  const recent = numbered.slice(split);
  const clips =
    numbered.length > 0
      ? [
          earlier.length > 0
            ? `Everything the creator has recorded so far, in order, up to the most recent clips.

<earlier-clips>
${earlier.join("\n")}
</earlier-clips>`
            : "",
          `The most recent clips, oldest first. This is where the creator is RIGHT NOW: the next clip follows straight on from the last one.

<most-recent-clips>
${recent.join("\n")}
</most-recent-clips>`,
        ]
          .filter(Boolean)
          .join("\n\n")
      : "The creator has not recorded anything yet: suggest the opening line of the video.";

  const plan = `
<role-context>
You are a teleprompter for a course creator recording a video one short clip at a time. After each clip, you show them what to say next.
</role-context>

${guides.length > 0 ? guides.join("\n\n") : "There is no plan for this video: continue naturally from the clips."}
`.trim();

  const now = `
${clips}

<the-ask>
Work out where the most recent clips sit in the plan, then write the very next thing the creator should say.

- Follow the plan: the Script or the Animatic is the guide for what comes next.
- If there are notes, they override the plan wherever the two disagree.
- Do not repeat anything the creator has already recorded, in any clip. Skip what the clips already cover.
- Keep it short: one clip's worth, one or two sentences at most.
- Write it in the creator's own voice, as heard in the clips: conversational, natural when read aloud.
- Bold the one to three words that matter most, the ones to stress, with Markdown: **like this**.
</the-ask>

<output-format>
Output ONLY the spoken words. No quotes, no "you should say...", no stage directions. The only markdown allowed is **bold**.
</output-format>
`.trim();

  return { plan, now };
};

export const generateSuggestNextClipPrompt = (
  input: SuggestNextClipInput
): string => {
  const { plan, now } = generateSuggestNextClipPromptParts(input);
  return `${plan}\n\n${now}`;
};
