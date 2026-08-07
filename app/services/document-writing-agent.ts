import { generateArticlePrompt } from "@/prompts/generate-article";
import { generateStepsToCompleteForSkillBuildingProblemPrompt } from "@/prompts/generate-steps-to-complete-for-skill-building-problem";
import { generateNewsletterPrompt } from "@/prompts/generate-newsletter";
import { generateSeoDescriptionPrompt } from "@/prompts/generate-seo-description";
import type { GlobalLink } from "@/prompts/link-instructions";
import { getBeatsSection } from "@/prompts/beats-instructions";
import { getScriptSection } from "@/prompts/script-instructions";
import {
  ToolLoopAgent as Agent,
  tool,
  type LanguageModel,
  type SystemModelMessage,
  stepCountIs,
} from "ai";
import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import type {
  TextWritingAgentCodeFile,
  TextWritingAgentImageFile,
} from "./text-writing-agent";
import { CACHE_BREAKPOINT_1H } from "./prompt-cache";

export type DocumentWritingAgentMode =
  "article" | "skill-building" | "newsletter" | "seo-description-document";

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

/**
 * Render the other fields on the same page as reference context.
 *
 * This is NOT part of the system prompt, and must not become part of it. In
 * the SEO writer the "related field" is the entire lesson body, which changes
 * on every keystroke in the other pane; in the body writer it is the SEO
 * description. Sending it as a message keeps that churn behind the system and
 * screenshot cache breakpoints, where it can only invalidate itself.
 *
 * Returns undefined when there is nothing worth sending.
 */
export const formatRelatedFields = (
  fields: ReadonlyArray<{ label: string; value: string }>
): string | undefined => {
  const populated = fields.filter((field) => field.value.trim());
  if (populated.length === 0) return undefined;

  return `## Related Fields

The following fields from the same lesson page are provided as reference. Use them to stay consistent, but do not simply copy them:

${populated
  .map((field) => `<field label="${field.label}">\n${field.value}\n</field>`)
  .join("\n\n")}`;
};

export type DocumentWritingContext = {
  mode?: DocumentWritingAgentMode;
  transcript: string;
  code: TextWritingAgentCodeFile[];
  imageFiles: TextWritingAgentImageFile[];
  sectionNames?: string[];
  /** Quiz ids owned by other videos in this course. */
  existingQuizIds?: string[];
  links?: GlobalLink[];
  courseStructure?: string;
  memory?: string;
  /** Pre-formatted beat plan text (kinds + titles + descriptions). */
  beats?: string;
  /** The video's script — the base Matt improvised from. */
  script?: string;
};

/**
 * Build the writer's system prompt as a single cache-breakpointed block.
 *
 * Exported so a test can assert the cache layout directly. A dropped
 * breakpoint produces no error and no visible defect — just a silently larger
 * bill — so the structure is worth pinning down.
 *
 * Every part of this block is stable for the life of a writing session. That
 * is the whole point: content that churns (the related page fields, the
 * document itself) is sent as messages by the route, so that it lands AFTER
 * this breakpoint and cannot invalidate it.
 */
export const buildDocumentWritingSystemMessage = (
  props: DocumentWritingContext
): SystemModelMessage => {
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
          existingQuizIds: props.existingQuizIds,
        });
    }
  })();

  // These instructions deliberately do NOT branch on whether a document
  // exists. They used to, which meant the first draft landing rewrote the
  // system prompt and threw away the whole cached prefix — transcript,
  // screenshots and all — exactly once per document. The model picks its tool
  // from the presence of <current-document> instead, so the prefix now
  // survives the write-to-edit transition.
  const documentInstructions = `

## Document Instructions

Which tool you use depends on whether a document already exists.

**If the user's messages contain a <current-document> tag, a document exists.** You MUST use the \`editDocument\` tool to make changes. Do not output the full content as plain text.

IMPORTANT: The user may have manually edited the document since your last tool call. The <current-document> tag always contains the latest version of the document. Do NOT assume your previous tool call inputs reflect the current state — always reference <current-document> as the single source of truth when planning edits.

Use minimal, surgical edits:
- \`replace\`: Find a unique passage of old_text and replace it with new_text. Include enough surrounding context in old_text to ensure a unique match.
- \`insert_after\`: Find a unique anchor string and insert new_text immediately after it.
- \`rewrite\`: Replace the entire document (use only for major restructuring when asked).

You can include multiple edits in a single editDocument call. Edits are applied sequentially — each edit sees the document as modified by prior edits.

If an edit fails (e.g. text not found), you will receive an error message. Read it carefully and retry with corrected text.

**If there is no <current-document> tag, there is no document yet.** You MUST use the \`writeDocument\` tool to create the content. Do not output the content as plain text — always use the tool.

Never call \`writeDocument\` when a <current-document> tag is present: that would discard the user's existing work. Never call \`editDocument\` when one is absent.

## Adding Screenshots

When the user asks you to add a screenshot or image from the video, you MUST use the \`<ChooseScreenshot clipIndex={N} alt="description" />\` component — do NOT insert a raw markdown image like \`![alt](url)\`. The ChooseScreenshot component lets the user interactively select the exact frame from the video clip. The clipIndex must reference a valid clip index from the transcript.

A local markdown image in <current-document> — \`![description](./path/to/frame.png)\` — is a screenshot the user has already resolved: they picked that frame themselves, and the component was replaced in place. Treat it as finished work. Keep the image where it is and edit the prose around it.

After calling a tool, you may add a brief conversational message explaining what you did.`;

  const memorySection = props.memory
    ? `\n\n## Course Memory\n\nThe following is course-level context provided by the author. Use it to inform your response:\n\n<memory>\n${props.memory}\n</memory>`
    : "";

  const beatsSection = getBeatsSection(props.beats ?? "");

  const scriptSection = getScriptSection(props.script ?? "");

  return {
    role: "system",
    content:
      basePrompt +
      documentInstructions +
      scriptSection +
      beatsSection +
      memorySection,
    providerOptions: CACHE_BREAKPOINT_1H,
  };
};

export const createDocumentWritingAgent = (
  props: DocumentWritingContext & { model: LanguageModel }
) => {
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

  // Both tools are always registered. Changing the tool set invalidates the
  // tools, the system prompt AND the messages, so a tool set that flipped
  // when the first draft landed was throwing the entire cache away.
  return new Agent({
    model: props.model,
    instructions: [buildDocumentWritingSystemMessage(props)],
    tools: {
      writeDocument: writeDocumentTool,
      editDocument: editDocumentTool,
    },
    stopWhen: stepCountIs(5),
    experimental_repairToolCall: repairToolCall,
  });
};
