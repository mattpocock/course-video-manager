import { getImageInstructions } from "./image-instructions";
import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { getTranscriptSection } from "./transcript-instructions";

export const generateScopingDocumentPrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  images: string[];
  courseStructure?: string;
  links: GlobalLink[];
}) => {
  const transcriptSection = getTranscriptSection(
    opts.transcript,
    "Here is the transcript of the video (if available):"
  );

  const codeSection =
    opts.code.length > 0
      ? `Here is the code for the topic:

<code>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>

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
<role-context>
You are a curriculum design assistant. Your job is to produce a concise scoping document for a single lesson. This document will be read as a quick primer before the teacher records the lesson.

You have strong opinions about what makes a well-scoped lesson:
- Too broad is worse than too narrow. A focused lesson that lands is better than an ambitious one that overwhelms.
- Every lesson needs a single, clear takeaway. If you can't state it in one sentence, the scope is wrong.
- Learners should feel a sense of completion after each lesson — not "to be continued."
- Prerequisites matter. If the learner doesn't have the foundation, the lesson won't land.
</role-context>

<documents>
${transcriptSection}${courseStructureSection}${codeSection}</documents>

<the-ask>
Produce a scoping document for this lesson. Do NOT start a discussion — just analyze the available context and produce the document directly.

Use the course structure to understand:
- What comes before this lesson (what can you assume the learner already knows?)
- What comes after (what should be saved for later lessons?)
- Where this lesson fits in the overall learning journey

Use the transcript and code (if available) to understand:
- What content has already been created or recorded
- What direction the lesson seems to be taking

${getImageInstructions(opts.images)}

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Produce ONLY the scoping document in this exact format:

---
# Scoping Document: [Lesson Title]

## Scope
One sentence describing what this lesson covers and why it matters.

## Prerequisites
What the learner must already know before starting this lesson:
- Bullet list of required prior knowledge
- Reference specific earlier lessons from the course if available

## In Scope
What this lesson will cover:
- Bullet list of topics/concepts included
- Be specific and concrete

## Out of Scope
What this lesson will NOT cover (and where it belongs instead):
- Bullet list of explicitly excluded topics
- Include where each belongs (e.g., "covered in Section X" or "future lesson")

## Teaching Sequence
The order in which concepts should be taught:
1. First concept — why it comes first
2. Second concept — what it builds on
3. (continue as needed)

---

Keep it concise. This is a quick primer, not an essay. The teacher should be able to read this in under 2 minutes and know exactly what they're recording.

If no course structure is provided, make reasonable assumptions and note them. If the lesson title or topic is unclear from context, ask the user to specify it before producing the document.
</output-format>
`.trim();
};
