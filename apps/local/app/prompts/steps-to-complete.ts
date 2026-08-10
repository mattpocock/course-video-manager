export const STEPS_TO_COMPLETE = `
<steps-to-complete>
Steps to complete should be in the format of checkboxes. Only the top level steps should be checkboxes. You can can use nested lists, but they should not be checkboxes.

Each top-level step should be separated by two newlines.

Subheadings can group multiple steps together.

<steps-output-example>

## Steps To Complete

### <Some subheading>

- [ ] <A description of the step to take>

Some accompanying text for the step

\`\`\`ts
// Some TypeScript code in here, maybe!
\`\`\`

- [ ] <A description of the step to take>

Some more accompanying text

- [ ] <A description of the step to take>

How about some more text?

</steps-output-example>

Include steps to test whether the problem has been solved, such as logging in the terminal (running the exercise via \`pnpm run dev\`), observing the local dev server at localhost:3000, or checking the browser console.

Steps to complete can use codeblocks too! This should especially be used when steps to complete is the only thing being generated.

<codeblock-example>

- [ ] <A description of the step to take>

\`\`\`ts
// Some TypeScript code in here!
\`\`\`

</codeblock-example>

If the step to complete is related to a TODO comment, include the TODO comment in full inside the relevant codeblock.

</steps-to-complete>
`.trim();
