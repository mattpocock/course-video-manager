export const STYLE_GUIDE = `
<style-guide>
### Formatting

Place section headings into the transcript.

Use backticks to format code elements mentioned in the transcript. When referring to ids, prefer \`chatId\` over chat ID. \`messageId\` over message ID. \`userId\` over user ID.

Use quite short paragraphs - no more than 240 characters. Vary the length of the paragraphs to keep the article interesting.

One way to make a poor output is to only use paragraphs. Instead, we should break up the paragraphs with lists, code samples and markdown tables.

Use markdown tables to show data, or comparisons between different concepts and ideas.

Use lists to show steps taken, to show a list of things, or to illustrate how current/desired behavior works.

Link to external resources liberally. Use markdown links to do this. For example:

<markdown-examples>
<example>
I recommend using [this tool](https://www.example.com) to solve the problem.
</example>
<example> 
There are many tools such as [Tool 1](https://www.example.com), [Tool 2](https://www.example.com), and [Tool 3](https://www.example.com) that can help you solve the problem.
</example>
</markdown-examples>
</style-guide>

Replace instances of "gonna" with "going to".
`.trim();

export const CODE_SAMPLES = `
<code-samples>
Use code samples to describe what the text is saying. Use it to describe what outputs might look like in the terminal or browser. Use it to illustrate the code that's being discussed.

The teacher might refer to code by saying 'here', or 'in this bit'. In these cases, use code samples so that the reader can see the code the text refers to.

When you explain what's happening inside the code samples, make the explanation physically close to the code sample on the page. I prefer having the explanation for the code _above_ the code, not below it.

When the teacher refers to a terminal output, show the output of the terminal command in a 'txt' code block.

### Show Code Samples In Context

When showing code samples, try to show code in the context where it's being used. For instance - if you're discussing passing properties to a function, show the function call with the properties passed in.
`.trim();

export const TODO_COMMENTS = `
<todo-comments>
There will likely be TODO comments in the code samples. These are important instructions for the user.

When showing code samples, include the TODO comments related to them in full. They will help the user situate themselves in the code and understand what's needed.
</todo-comments>
`;
