export const STEPS_TO_COMPLETE = `
<steps-to-complete>
Steps to complete should be in the format of checkboxes. Only the top level steps should be checkboxes. You can can use nested lists, but they should not be checkboxes.

Each top-level step should be separated by two newlines.

<steps-output-example>

## Steps To Complete

- [ ] <A description of the step to take>
  - <some substep>

- [ ] <A description of the step to take>

- [ ] <A description of the step to take>
  - <some substep>
  - <some substep>

</steps-output-example>

Include steps to test whether the problem has been solved, such as logging in the terminal (running the exercise via \`pnpm run dev\`), observing the local dev server at localhost:3000, or checking the browser console.

Steps to complete can use codeblocks too! This should especially be used when steps to complete is the only thing being generated.

<codeblock-example>

- [ ] <A description of the step to take>

\`\`\`ts
// Some TypeScript code in here!
\`\`\`

</codeblock-example>
</steps-to-complete>
`.trim();
