export const PROJECT_STYLE_GUIDE = `
<style-guide>

## Formatting

- Keep paragraphs short (max 240 characters).
- Use backticks for code elements: functions, types, libraries, properties, file names.
- Replace "gonna" with "going to".

## Heading Structure

- Start with H2 for the main title (extracted from commit message)
- Use H3 for "Steps To Complete"
- Use H4 for each substep grouping

## Code Blocks

- Show imports directly (not in spoilers)
- Show terminal commands directly (not in spoilers)
- Wrap solution code in <Spoiler> tags
- Solution code = code the user needs to write/understand
- Keep explanations above code, not below

## Spoiler Tag Usage

Wrap in <Spoiler>:
- Function implementations
- Complex logic
- Code transformations
- Any code the user should try to write themselves

Example of code IN spoiler:
<Spoiler>

\`\`\`typescript
export async function searchWithBM25(keywords: string[], emails: Email[]) {
  const corpus = emails.map((email) => \`\${email.subject} \${email.body}\`);
  const scores: number[] = (BM25 as any)(corpus, keywords);
  return scores
    .map((score, idx) => ({ score, email: emails[idx] }))
    .sort((a, b) => b.score - a.score);
}
\`\`\`

</Spoiler>

Do NOT wrap in <Spoiler>:
- Import statements
- Terminal commands
- Package installation commands
- Terminal output examples

Example of code NOT in spoiler:
\`\`\`typescript
import { loadEmails, searchWithBM25 } from '../search';
\`\`\`

Example of command NOT in spoiler:
\`\`\`bash
pnpm add okapibm25
\`\`\`

## Concision

- Be sparse with words
- Focus on what changed and why
- Avoid unnecessary explanations
- Let code speak for itself

</style-guide>
`.trim();
