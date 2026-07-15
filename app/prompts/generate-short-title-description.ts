export const generateShortTitlePrompt = (opts: { transcript: string }) => {
  return `
<role-context>
You are a helpful assistant generating a short, descriptive title for a short-form vertical video (TikTok/YouTube Shorts style).

The title is an internal working name, not a published caption — it should help the creator identify the video at a glance in their library.
</role-context>

<documents>
<transcript>
${opts.transcript}
</transcript>
</documents>

<the-ask>
Generate a single short title (3-8 words) that captures the core topic of this video.

The title should:
- Be a concise label, not a clickbait headline
- Use sentence case (capitalize only the first word and proper nouns)
- Focus on the specific concept, tool, or technique discussed
- Help distinguish this video from others in a list

Examples of good short titles:
- "Type narrowing with discriminated unions"
- "Why Promise.all fails fast"
- "Zod schema validation basics"
- "React useEffect cleanup pattern"
</the-ask>

<output-format>
Respond with ONLY the title text. No quotes, no numbering, no explanation.
</output-format>
`.trim();
};

export const generateShortDescriptionPrompt = (opts: {
  transcript: string;
}) => {
  return `
<role-context>
You are a helpful assistant writing a brief description for a short-form vertical video (TikTok/YouTube Shorts style).

The description is an internal summary to help the creator remember what the video covers — it is not a published caption.
</role-context>

<documents>
<transcript>
${opts.transcript}
</transcript>
</documents>

<the-ask>
Generate a 1-2 sentence description summarizing what this video covers.

The description should:
- Summarize the key point or takeaway
- Be factual and specific, not promotional
- Use plain, direct language
- Be useful as a reminder of the video's content
</the-ask>

<output-format>
Respond with ONLY the description text. No quotes, no meta-commentary.
</output-format>
`.trim();
};
