import { getLinkInstructions, type GlobalLink } from "./link-instructions";

/**
 * SEO description generated purely from the lesson body (the written lesson
 * markdown), ignoring the transcript. Used by the "Generate SEO Description"
 * modal, which is driven by the body only.
 */
export const generateSeoDescriptionFromBodyPrompt = (opts: {
  body: string;
  links: GlobalLink[];
}) => {
  return `
<role-context>
You are a helpful assistant being asked to generate an SEO description for a coding lesson.

SEO descriptions appear in search engine results and should be compelling, accurate, and optimized for discovery.
</role-context>

<documents>
Here is the written lesson body (Markdown):

<lesson-body>
${opts.body}
</lesson-body>
</documents>

<the-ask>
Generate a concise SEO description (meta description) for this coding lesson, based solely on the lesson body above.

The description should:
- Accurately summarize what the viewer will learn
- Be compelling and encourage clicks from search results
- Include relevant keywords naturally
- Be no more than 160 characters

CRITICAL: The description MUST be 160 characters or fewer. This is a hard limit.

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the description.

Respond ONLY with the SEO description text. Do not include any other text, explanations, or formatting.

The response should be a single line of plain text, 160 characters or fewer.
</output-format>
`.trim();
};
