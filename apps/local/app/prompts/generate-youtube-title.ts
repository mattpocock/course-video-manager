import { getLinkInstructions, type GlobalLink } from "./link-instructions";
import { getTranscriptSection } from "./transcript-instructions";

export const generateYoutubeTitlePrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  images: string[];
  courseStructure?: string;
  links: GlobalLink[];
}) => {
  const transcriptSection = getTranscriptSection(opts.transcript);

  const codeSection =
    opts.code.length > 0
      ? `Here is the code for the video:

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
You are a helpful assistant being asked to generate a compelling YouTube title for a coding lesson video.

YouTube titles should be attention-grabbing, clickable, and clearly communicate the value or hook of the video.
</role-context>

<documents>
${transcriptSection}${courseStructureSection}${codeSection}</documents>

<the-ask>
Generate 10 different engaging YouTube titles for this coding lesson, each using a different framing device.

Each title should:
- Be compelling and encourage clicks
- Clearly indicate what the viewer will learn or discover
- Use conversational, engaging language
- Use sentence case (capitalize only the first word and proper nouns)
- Be concise (aim for 60-70 characters for optimal display)

Use these framing devices (one title per device):

1. **Problem-focused**: Identify the pain point immediately
   - Example: "Stop writing the same API boilerplate in every project"

2. **Practical outcome**: Promise a specific result
   - Example: "Build a full-stack app in 30 minutes with this pattern"

3. **Before/After revelation**: Show transformation
   - Example: "I refactored my database queries and cut response time by 80%"

4. **Curiosity/mystery**: Create intrigue
   - Example: "The React hook that changed how I think about state"

5. **Contrarian/counter-intuitive**: Challenge assumptions
   - Example: "Why you shouldn't always use async/await"

6. **Question format**: Pose the problem as a question
   - Example: "Why are your TypeScript types so complicated?"

7. **Numbers/Lists**: Promise specific takeaways
   - Example: "5 mistakes every developer makes with error handling"

8. **Direct command**: Tell them what to do
   - Example: "Write better tests without mocking everything"

9. **Social proof**: Reference what others don't know
   - Example: "Most developers don't know JavaScript has this feature"

10. **This/That structure**: Create clear contrast
    - Example: "This one pattern eliminates prop drilling forever"

Examples of good YouTube titles:
- "How I structure components for maximum reusability"
- "Most devs don't understand how closures actually work"
- "Ship production-ready code with this testing strategy"
- "Backend scaling is EASIER than you think (here's the secret)"

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the titles.

Respond with EXACTLY 10 titles, one per line, numbered 1-10.

Format:
1. [Title text here]
2. [Title text here]
...
10. [Title text here]

After listing all 10 titles, add a blank line and then provide your top 3 recommendations:

---

**Recommended Top 3:**

[Rank] #[Number] - [Brief explanation of why this title is most effective - focus on click-through potential, clarity, and emotional appeal]

Example:
- 1st: #4 - Creates immediate curiosity while clearly promising value; the word choice is conversational and relatable
- 2nd: #7 - Specific number creates tangible expectation; addresses common pain point directly
- 3rd: #2 - Strong action-oriented opening; practical outcome is crystal clear

Provide concise explanations (1-2 sentences max per recommendation).
</output-format>
`.trim();
};
