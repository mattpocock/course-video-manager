export type GlobalLink = {
  title: string;
  url: string;
  description: string | null;
};

export const getLinkInstructions = (links: GlobalLink[]): string => {
  if (links.length === 0) {
    return "";
  }

  const linkList = links
    .map((link) => {
      const description = link.description ? ` - ${link.description}` : "";
      return `- ${link.title}: ${link.url}${description}`;
    })
    .join("\n");

  return `
<available-links>
## Available Links (optional - use only if relevant)

The following links are available for use in the content. Only include links that are directly relevant to the topic being discussed. Do not force links into the content.

${linkList}
</available-links>
`.trim();
};
