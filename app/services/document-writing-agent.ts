import { generateArticlePrompt } from "@/prompts/generate-article";
import { generateStepsToCompleteForSkillBuildingProblemPrompt } from "@/prompts/generate-steps-to-complete-for-skill-building-problem";
import { generateNewsletterPrompt } from "@/prompts/generate-newsletter";
import { generateSeoDescriptionPrompt } from "@/prompts/generate-seo-description";
import type { GlobalLink } from "@/prompts/link-instructions";
import {
  ToolLoopAgent as Agent,
  tool,
  type LanguageModel,
  stepCountIs,
} from "ai";
import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import type {
  TextWritingAgentCodeFile,
  TextWritingAgentImageFile,
} from "./text-writing-agent";

export type DocumentWritingAgentMode =
  | "article"
  | "skill-building"
  | "newsletter"
  | "seo-description-document";

export const writeDocumentTool = tool({
  description:
    "Write the full document. Use this to create the initial content.",
  inputSchema: z.object({
    content: z.string().describe("The full markdown content of the document"),
  }),
  outputSchema: z.string(),
});

export const editDocumentTool = tool({
  description:
    "Edit the existing document with surgical changes. Use replace for targeted text changes, insert_after to add content after an anchor, or rewrite to replace the entire document.",
  inputSchema: z.object({
    edits: z.array(
      z.object({
        type: z
          .enum(["replace", "insert_after", "rewrite"])
          .describe("The type of edit to apply"),
        old_text: z
          .string()
          .optional()
          .describe(
            "For replace: the exact text to find and replace. Include enough context for a unique match."
          ),
        anchor: z
          .string()
          .optional()
          .describe(
            "For insert_after: the exact text after which to insert new content."
          ),
        new_text: z.string().describe("The new text to insert or replace with"),
        message: z
          .string()
          .describe(
            "A very short (max 20 chars) commit-style reason for this edit, e.g. 'fix typo', 'add intro', 'reword heading'"
          ),
      })
    ),
  }),
  outputSchema: z.string(),
});

export const createDocumentWritingAgent = (props: {
  model: LanguageModel;
  mode?: DocumentWritingAgentMode;
  document: string | undefined;
  transcript: string;
  code: TextWritingAgentCodeFile[];
  imageFiles: TextWritingAgentImageFile[];
  sectionNames?: string[];
  links?: GlobalLink[];
  courseStructure?: string;
  memory?: string;
  /** Other fields from the same page, offered as reference context. */
  additionalContext?: Array<{ label: string; value: string }>;
  /** Pre-formatted beat plan text (kinds + titles + descriptions). */
  beats?: string;
}) => {
  const links = props.links ?? [];
  const mode = props.mode ?? "article";

  const basePrompt = (() => {
    switch (mode) {
      case "skill-building":
        return generateStepsToCompleteForSkillBuildingProblemPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "newsletter":
        return generateNewsletterPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "seo-description-document":
        return generateSeoDescriptionPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "article":
      default:
        return generateArticlePrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          sectionNames: props.sectionNames,
          courseStructure: props.courseStructure,
          links,
        });
    }
  })();

  const documentInstructions = props.document
    ? `

## Document Editing Instructions

A document already exists. The user will provide it in a <current-document> tag. You MUST use the \`editDocument\` tool to make changes. Do not output the full content as plain text.

IMPORTANT: The user may have manually edited the document since your last tool call. The <current-document> tag always contains the latest version of the document. Do NOT assume your previous tool call inputs reflect the current state — always reference <current-document> as the single source of truth when planning edits.

Use minimal, surgical edits:
- \`replace\`: Find a unique passage of old_text and replace it with new_text. Include enough surrounding context in old_text to ensure a unique match.
- \`insert_after\`: Find a unique anchor string and insert new_text immediately after it.
- \`rewrite\`: Replace the entire document (use only for major restructuring when asked).

You can include multiple edits in a single editDocument call. Edits are applied sequentially — each edit sees the document as modified by prior edits.

If an edit fails (e.g. text not found), you will receive an error message. Read it carefully and retry with corrected text.

## Adding Screenshots

When the user asks you to add a screenshot or image from the video, you MUST use the \`<ChooseScreenshot clipIndex={N} alt="description" />\` component — do NOT insert a raw markdown image like \`![alt](url)\`. The ChooseScreenshot component lets the user interactively select the exact frame from the video clip. The clipIndex must reference a valid clip index from the transcript.

After calling editDocument, you may add a brief conversational message explaining what you changed.`
    : `

## Document Writing Instructions

There is no document yet. You MUST use the \`writeDocument\` tool to create the content. Do not output the content as plain text — always use the tool.

After calling writeDocument, you may add a brief conversational message explaining what you wrote.`;

  const additionalContext = (props.additionalContext ?? []).filter((f) =>
    f.value.trim()
  );
  const additionalContextSection =
    additionalContext.length > 0
      ? `\n\n## Related Fields\n\nThe following fields from the same lesson page are provided as reference. Use them to stay consistent, but do not simply copy them:\n\n${additionalContext
          .map((f) => `<field label="${f.label}">\n${f.value}\n</field>`)
          .join("\n\n")}`
      : "";

  const systemPrompt =
    basePrompt + additionalContextSection + documentInstructions;

  const memorySection = props.memory
    ? `\n\n## Course Memory\n\nThe following is course-level context provided by the author. Use it to inform your response:\n\n<memory>\n${props.memory}\n</memory>`
    : "";

  const beatsSection = props.beats
    ? `\n\n## Beat Plan\n\nThe following is the video's beat plan — the planned structure of what the video covers, in order. Each beat has a kind (Definition, Walkthrough, Playthrough, Quest, Reaction) and may have a description. Use this to understand the video's intended flow and structure:\n\n<beats>\n${props.beats}\n</beats>`
    : "";

  const repairToolCall: ConstructorParameters<
    typeof Agent
  >[0]["experimental_repairToolCall"] = async ({ toolCall }) => {
    try {
      const repairedInput = jsonrepair(toolCall.input);
      return { ...toolCall, input: repairedInput };
    } catch {
      return null;
    }
  };

  if (props.document) {
    return new Agent({
      model: props.model,
      instructions: systemPrompt + memorySection + beatsSection,
      tools: { editDocument: editDocumentTool },
      stopWhen: stepCountIs(5),
      experimental_repairToolCall: repairToolCall,
    });
  }

  return new Agent({
    model: props.model,
    instructions: systemPrompt + memorySection + beatsSection,
    tools: { writeDocument: writeDocumentTool },
    stopWhen: stepCountIs(5),
    experimental_repairToolCall: repairToolCall,
  });
};
