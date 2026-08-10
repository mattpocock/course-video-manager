export const getImageInstructions = (images: string[]): string => {
  if (images.length === 0) {
    return "";
  }

  return `
  <image-instructions>
The video the transcript is based on contains some diagrams. You have been provided with the diagrams. Use them as markdown links in the output:

<example>
![Diagram 1](./path/to/diagram.png)
</example>
<example>
![Diagram 2](./path/to/diagram.png)
</example>
</image-instructions>
`.trim();
};
