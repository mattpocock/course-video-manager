/**
 * How the Article Writer authors a quiz.
 *
 * The rules here are one of two live copies — the other is
 * `.claude/skills/creating-content/quizzes.md` in the personal wiki, which
 * holds the same contract for agents drafting outside this app. Change both.
 */

export const getQuizInstructions = (existingQuizIds: string[]) => {
  const takenSection =
    existingQuizIds.length > 0
      ? `These ids are already used elsewhere in the course. Do not reuse any of them:

${existingQuizIds.map((id) => `- ${id}`).join("\n")}

`
      : "";

  return `
## Quizzes

A quiz is **friction**. It stops a reader who was moving, so it is spent, never sprinkled. Spend it on what the reader paid you to teach — the concepts, the decisions, the way of working. Setup, install and tooling admin are the cost of reaching the teaching rather than the teaching itself, and a reader still getting set up has no attention spare for a question.

Where an article earns a quiz, it holds two to four questions and sits at the very end of the body, after the last section.

A question tests one of two things, and nothing else:

- A **decision** the reader has to make — two ways of working, both of which a real person would try.
- A **recall** of a fact a later lesson depends on: a flag, a default, a limit. The reader walks back through the article to answer it, and that walk is the point.

An article holding no decision and no load-bearing recall gets no quiz. Report that gap for a human to judge.

Write the choices like this:

- Every wrong choice is something a real reader would actually do. A choice nobody would pick makes the question free.
- The correct answer is the same length as the wrong ones. A reader who spots the longest choice never reads the question.
- The explanation says why the wrong choices are wrong, not only why the right one is right.

Each question carries an \`id\` that names the concept it tests — \`subagent-context-isolation\`, never \`quiz-1\`. Reader answers are keyed to the id, so it must be unique across the whole course.

${takenSection}Write the quiz exactly like this, with every value a literal — no variables, no spreads, no expressions:

<Quiz>
  <QuizQuestion data={{
    id: "unique-identifier",
    question: "The prompt text",
    type: "multiple-choice",
    choices: [
      { answer: "a", label: "Option one" },
      { answer: "b", label: "Option two" }
    ],
    correct: "a",
    answer: "Explanation shown after answering"
  }} />
</Quiz>

\`type\` is always \`"multiple-choice"\`. A question needs two or more choices, each with a short stable \`answer\` key and a \`label\`. \`correct\` names one choice's \`answer\`; an array of them makes the question multi-select, graded as an exact set — every correct answer and no others, or no credit — so use it only where that severity is earned.

Two optional fields: \`allowMultiple\` shows checkboxes when only one answer is correct, and \`shuffleChoices\` (default true) can be set false to hold the authored order. Choice order is shuffled for the reader, so where you put the correct answer makes no difference.
`.trim();
};
