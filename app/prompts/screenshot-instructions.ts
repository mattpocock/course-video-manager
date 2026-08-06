export const SCREENSHOT_INSTRUCTIONS = `
## Screenshot Placement

The transcript includes sequential clip indices in the format \`[N] clip text\`. You can reference these clips to suggest screenshot placement using the \`<ChooseScreenshot>\` component.

Insert \`<ChooseScreenshot clipIndex={N} alt="description of what's on screen" />\` in your output:
1. When the transcript references something visual on screen (e.g., UI elements, code on screen, terminal output)
2. To break up heavily textual sections with visual interest

The \`clipIndex\` must match a clip index from the transcript. The \`alt\` should describe what's visible on screen at that point.

Example: \`<ChooseScreenshot clipIndex={3} alt="VS Code showing the TypeScript error" />\`

Each \`<ChooseScreenshot>\` is a placeholder that the user resolves by hand. The user picks the exact frame in the UI, and the component becomes a local markdown image in its place — \`![description](./path/to/frame.png)\`. This is the normal path for every screenshot: place the component, and expect a local image where you put it.
`.trim();
