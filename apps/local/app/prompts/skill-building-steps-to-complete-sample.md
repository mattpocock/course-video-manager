We're going to add a new tool to our agent system - one that asks clarifying questions when a user's request is missing critical information.

This is inspired by Claude's approach to handling ambiguous user requests. Instead of guessing what the user wants, the agent will intelligently recognize when it needs more details and ask for them using a structured UI.

The challenge here is that we have many tools competing for the LLM's attention. You'll need to use careful tool descriptions and system prompts to make sure the agent recognizes when clarification is truly needed.

## Steps To Complete

### Set Up Your Evaluation

- [ ] Review the test cases in `ask-for-clarification.eval.ts`

The eval file contains several scenarios where users make incomplete requests:

```ts
data: [
  // Flight booking with missing critical details
  {
    input: createUIMessageFixture('Book a flight to Paris'),
  },
  // Email with missing recipient details
  {
    input: createUIMessageFixture('Send John an email'),
  },
  // Invoice creation with no details
  {
    input: createUIMessageFixture(
      'Create an invoice for the client',
    ),
  },
  // TODO: add more test cases here
],
```

- [ ] Add 7-10 more test cases with incomplete requests

These should represent scenarios missing critical information. Consider:

- Translation requests without target language or text
- Weather checks without a location
- Social media posts without content or scheduling time
- Task creation with no details
- Calendar searches without specifics
- File compression without source/destination paths

### Implement the Scorer

- [ ] Implement the `Called askForClarification` scorer

This scorer checks whether the agent called the `askForClarification` tool:

```ts
scorers: [
  {
    name: 'Called askForClarification',
    description:
      'The agent called the askForClarification tool',
    scorer: ({ output }) => {
      // TODO: Implement the scorer
      // Return 1 if askForClarification was called, 0 otherwise
      // Hint: Check if any tool in output.toolCalls has toolName === 'askForClarification'
      return 0;
    },
  },
],
```

The scorer should return `1` if any tool call has `toolName === 'askForClarification'`, and `0` otherwise.

### Build the askForClarification Tool

- [ ] Define the schema for the `askForClarification` tool in `agent.ts`

The tool needs a `questions` array. Each question object should have:

- `question`: The question text
- `field`: The field name this question relates to
- `options`: An array of pre-filled answer choices

```ts
askForClarification: tool({
  // TODO: Write a description for the tool
  description: '',
  inputSchema: z.object({
    // TODO: Add the schema here
  }),
  execute: async () => {
    return 'askForClarification tool called';
  },
}),
```

- [ ] Write a clear description for the tool

The description should explain when this tool should be used - specifically when a request is missing critical information needed to complete the task.

### Configure the System Prompt

- [ ] Update the system prompt in `runAgent()` to instruct the agent when to use this tool

```ts
system: `Today's date is ${new Date().toISOString().split('T')[0]}.

// TODO: Update the system prompt to instruct the agent to use the
// askForClarification tool when the user's request is missing
// critical information needed to complete the task
`,
```

Your system prompt should:

- Explain when to use the `askForClarification` tool
- Provide concrete examples showing how the tool should be called
- Include example questions, fields, and pre-filled options for scenarios like flight bookings, emails, and invoices
- Clarify that the tool should ONLY be used when information is truly missing
- Emphasize that other tools should NOT be called if clarification is needed first

Look at the solution file for inspiration on the structure and detail level needed in these examples.

### Test Your Implementation

- [ ] Run the evaluation with `pnpm run dev`

You should see your eval running and showing results for each test case.

- [ ] Check that the `Called askForClarification` scorer is working

The scorer should show `1` for each test case where the agent correctly called the tool, and `0` for cases where it didn't.

- [ ] Iterate on your tool description and system prompt until you reach 100%

This will likely require several iterations. Pay close attention to:

- The clarity of your tool description in the Zod schema
- The quality of your system prompt examples
- Whether you need to adjust the describe fields to guide the agent better

- [ ] (Optional) Test with multiple models using `evalite.each()`

Try testing with both Gemini 2.0 Flash and GPT-4 Mini to see if different models have different success rates at recognizing when clarification is needed.
