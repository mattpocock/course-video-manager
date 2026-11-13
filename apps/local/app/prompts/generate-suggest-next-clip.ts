import { z } from "zod";
import { unifiedLineDiff } from "@/lib/unified-line-diff";

/**
 * The prompt behind the Video Editor's **Suggestions** tab: what should the
 * author say in the next **Clip**?
 *
 * The guide is the **Script** or the **Animatic** (whichever sources the author
 * ticked); the **Beats** say what each part of the Video is for. Every Clip
 * recorded so far goes in, numbered in order; the last few are set apart as
 * where the author is now, matched against that guide. Every source is optional: an unticked or missing one is
 * simply left out. The repo files the author picked in the Context modal,
 * read by the route, come first in the plan. The words on the
 * **Diagram** on screen right now go with the Clips, since they change from
 * one Clip to the next. When the Clip just before the Insertion Point has a
 * **DiagramSnapshot** pinned, they go as a diff against it, so the model sees
 * what the author has changed on screen since that Clip. The transcripts of
 * the **previous Video**'s Clips come last in the plan, straight before this
 * Video's Clips, so the conversation reads in order. The **Steer** in effect,
 * the author's own instruction for the next Clip, comes after the Clips and
 * outranks everything.
 */
export type SuggestNextClipInput = {
  /**
   * The Steer in effect at the Insertion Point: the author's own instruction
   * for the next Clip, which outranks everything else.
   */
  steer?: string;
  script?: string;
  animatic?: string;
  beats?: string;
  /**
   * The Diagram Text of the Active Diagram, the one on screen now, one line
   * per shape.
   */
  diagram?: string;
  /**
   * The DiagramSnapshot pinned to the Clip just before the Insertion Point,
   * if it has one. The route reads its text, to diff the Diagram against.
   */
  diagramSnapshotId?: string;
  /**
   * Transcripts of the previous Video's Clips (the one before this in course
   * order), one per line, oldest first.
   */
  previousVideo?: string;
  /** Transcripts of every Clip before the Insertion Point, oldest first. */
  clips: string[];
  /**
   * The paths of the Video's repo files the author picked in the Context
   * modal, sorted. The route reads them; the prompt gets their text.
   */
  files?: string[];
};

/** One picked repo file, as the route read it. */
export type SuggestNextClipRepoFile = { path: string; content: string };

/** What the prompt is built from: the request, with the files read. */
export type SuggestNextClipPromptInput = Omit<
  SuggestNextClipInput,
  "files" | "diagramSnapshotId"
> & {
  files?: SuggestNextClipRepoFile[];
  /**
   * The Diagram Text of the DiagramSnapshot pinned to the Clip just before
   * the Insertion Point, one line per shape, as the route read it.
   */
  lastClipDiagram?: string;
};

/**
 * The most repo-file text one suggestion carries, in characters (about 50k
 * tokens). The files come in path order; the one that crosses the line
 * is cut short and any after it are named but left empty, so a stray
 * lockfile cannot blow the fast model's context or the cache.
 */
export const MAX_REPO_FILES_CHARS = 200_000;

const formatRepoFiles = (files: SuggestNextClipRepoFile[] | undefined) => {
  if (!files || files.length === 0) return undefined;
  let budget = MAX_REPO_FILES_CHARS;
  return files
    .map((file) => {
      const fits = file.content.length <= budget;
      const content = fits
        ? file.content
        : `${file.content.slice(0, budget)}\n[… cut: over the repo files limit]`;
      budget = Math.max(0, budget - file.content.length);
      return `<file path="${file.path}">\n${content}\n</file>`;
    })
    .join("\n");
};

/**
 * The most Diagram Text one suggestion carries, in characters: a diagram's
 * words are a few hundred at most, so anything past this is cut with a marker.
 */
export const MAX_DIAGRAM_TEXT_CHARS = 4_000;

const capDiagramText = (text: string | undefined) =>
  text && text.length > MAX_DIAGRAM_TEXT_CHARS
    ? `${text.slice(0, MAX_DIAGRAM_TEXT_CHARS)} [… cut: over the diagram text limit]`
    : text;

/** Diagram Text sent one line per shape, as the single line it is shown as. */
const flattenDiagramText = (text: string) => text.replace(/\s+/g, " ").trim();

const diagramLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * The on-screen Diagram's section of the prompt. With no DiagramSnapshot on
 * the last Clip, its words as one line, as ever; with one, a unified diff of
 * the snapshot's lines against the Diagram's now, or the one line again with
 * a note when nothing has changed.
 */
const diagramSection = (
  diagram: string | undefined,
  lastClipDiagram: string | undefined
) => {
  if (!diagram || diagram.trim().length === 0) return "";
  const intro =
    "The words on the diagram on screen right now, flattened into one line: what the viewer is looking at as the creator speaks. It shows where they are; it is not something they have said.";
  if (lastClipDiagram === undefined) {
    return section(
      "diagram-on-screen",
      intro,
      capDiagramText(flattenDiagramText(diagram))
    );
  }
  const before = diagramLines(lastClipDiagram);
  const after = diagramLines(diagram);
  if (before.join("\n") === after.join("\n")) {
    return section(
      "diagram-on-screen",
      `${intro} It is unchanged since the last clip.`,
      capDiagramText(flattenDiagramText(diagram))
    );
  }
  // Not through `section`: its trim would eat the first line's ` ` column.
  return [
    "The diagram on screen right now, one line per shape, as a diff against the diagram that was on screen in the last clip: a line starting with + was added since the last clip, a line starting with - was removed, and a line starting with a space is unchanged. What changed is likely what the creator talks about next. It shows what the viewer sees; it is not something the creator has said.",
    "",
    "<diagram-changes-since-last-clip>",
    capDiagramText(unifiedLineDiff(before, after)),
    "</diagram-changes-since-last-clip>",
  ].join("\n");
};

/**
 * The most of the previous Video's Clips one suggestion carries, in
 * characters. The END is kept: the Clips nearest the join matter most.
 */
export const MAX_PREVIOUS_VIDEO_CHARS = 6_000;

const PREVIOUS_VIDEO_CUT_MARKER = "[… cut: earlier clips over the limit]\n";

/** The previous Video's Clips, cut from the front past the limit. */
export const capPreviousVideoText = (text: string): string =>
  text.length > MAX_PREVIOUS_VIDEO_CHARS
    ? `${PREVIOUS_VIDEO_CUT_MARKER}${text.slice(-MAX_PREVIOUS_VIDEO_CHARS)}`
    : text;

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
  input: SuggestNextClipPromptInput
): { plan: string; now: string } => {
  const guides = [
    section(
      "repo-files",
      "Files from this video's code repo that the creator picked as context: what the video is about, as code.",
      formatRepoFiles(input.files)
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

  const previousVideo = section(
    "previous-video-clips",
    "What the creator said in the previous video of the course, clip by clip, oldest first: the viewer has just watched it. This video picks up where it left off, so open by carrying on from it, and do not repeat it.",
    input.previousVideo && capPreviousVideoText(input.previousVideo)
  );

  const plan = `
<role-context>
You are a teleprompter for a course creator recording a video one short clip at a time. After each clip, you show them what to say next.
</role-context>

${guides.length > 0 ? guides.join("\n\n") : "There is no plan for this video: continue naturally from the clips."}
${previousVideo ? `\n${previousVideo}\n` : ""}`.trim();

  const diagram = diagramSection(input.diagram, input.lastClipDiagram);

  const steer = section(
    "steer",
    "The creator's own instruction for the next clip: where they are going next. It takes PRIORITY over everything else: where it disagrees with the Script, the Animatic or the Beats, follow it.",
    input.steer
  );

  const now = `
${clips}
${diagram ? `\n${diagram}\n` : ""}${steer ? `\n${steer}\n` : ""}
<the-ask>
Work out where the most recent clips sit in the plan, then write the one thing the creator should say next.

- ${steer ? "Follow the creator's instruction for the next clip; use the plan only for what it leaves open." : "Follow the plan: the Script or the Animatic is the guide for what comes next. Give the best single guess."}
- Do not repeat anything the creator has already recorded, in any clip. Skip what the clips already cover.
- Keep it short: one clip's worth, one or two sentences at most.
- Write it in the creator's own voice, as heard in the clips: conversational, natural when read aloud.
- Bold the one to three words that matter most, the ones to stress, with Markdown: **like this**.
</the-ask>

<output-format>
The text is the spoken words alone: no quotes around them, no stage directions. The only markdown allowed is **bold**.
</output-format>
`.trim();

  return { plan, now };
};

export const generateSuggestNextClipPrompt = (
  input: SuggestNextClipPromptInput
): string => {
  const { plan, now } = generateSuggestNextClipPromptParts(input);
  return `${plan}\n\n${now}`;
};

/**
 * The shape of the model's answer: one Suggestion's text. Only this reaches
 * the editor, so commentary the model might add around it has nowhere to go.
 */
export const suggestionsSchema = z.object({
  text: z
    .string()
    .describe(
      "The very next words the creator says, and nothing else. The only markdown allowed is **bold**."
    ),
});

type PartialSuggestion = { text?: string };

/**
 * The Suggestion as the model writes it, as newline-delimited JSON: each line
 * is its text so far, as a JSON string, sent whenever it grows. Read it back
 * with {@link readSuggestionLines}.
 */
export const suggestionsLineStream = (
  partials: ReadableStream<PartialSuggestion>
): ReadableStream<string> => {
  let sent = "";
  return partials.pipeThrough(
    new TransformStream<PartialSuggestion, string>({
      transform(partial, controller) {
        const text = partial.text ?? "";
        if (text === sent) return;
        controller.enqueue(`${JSON.stringify(text)}\n`);
        sent = text;
      },
    })
  );
};

/**
 * The newest text in what has arrived of a {@link suggestionsLineStream}: the
 * last complete line, or `null` before the first one. A line that does not
 * parse as a string is skipped.
 */
export const readSuggestionLines = (received: string): string | null => {
  const lines = received.split("\n").slice(0, -1);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(lines[i]!);
      if (typeof parsed === "string") return parsed;
    } catch {
      // A torn line: try the one before.
    }
  }
  return null;
};
