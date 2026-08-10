import { runtimeLive } from "@/services/layer.server";
import {
  acquireTextWritingContext,
  createModelMessagesForTextWritingAgent,
  createTextWritingAgent,
} from "@/services/text-writing-agent";
import { anthropic } from "@ai-sdk/anthropic";
import { Array, Effect } from "effect";
import { evalite } from "evalite";
import { wrapAISDKModel } from "evalite/ai-sdk";
import type { LanguageModel } from "ai";

const lessons = [
  // 01-retrieval-day-1
  {
    videoId: "7793e2c8-7e11-45bc-88a2-de44e297535b",
  },
  {
    videoId: "fc248991-e9ac-4355-a439-7c0c11b68d4b",
  },
  {
    videoId: "15a4636e-5012-4c81-a015-7222fd8f8454",
  },
  {
    videoId: "d197f403-abb4-447a-a38a-8b044635b93a",
  },
  // {
  //   videoId: "57994701-0e93-4bf4-846c-dba3bfe6e2b3",
  // },
  // 03-retrieval-day-2
  {
    videoId: "76a50e00-e8c0-4b31-881e-323853bc0a1e",
  },
  {
    videoId: "8397bd25-5d5b-4665-8bbd-08144adbc11e",
  },
];

const EVALS_TO_RUN = 6;
const STEPS_TO_COMPLETE_SIGIL = "\n## Steps To Complete\n";
const INTRO_MAX_LENGTH_IN_CHARS = 1000;

evalite.each([
  {
    name: "Haiku 4.5",
    input: anthropic("claude-haiku-4-5") as any,
    only: true,
  },
  {
    name: "Sonnet 4.5",
    input: anthropic("claude-sonnet-4-5") as any,
  },
])("Skill Building Text", {
  data: async () => {
    return Effect.all(
      lessons.map((lesson) =>
        Effect.gen(function* () {
          const context = yield* acquireTextWritingContext({
            videoId: lesson.videoId,
            enabledFiles: undefined,
          });

          return { input: context };
        })
      )
    ).pipe(Effect.map(Array.takeRight(EVALS_TO_RUN)), runtimeLive.runPromise);
  },
  columns: ({ input, output }) => {
    const numberOfHeadings = (output as string)
      // Ignore the first heading
      .slice(1)
      .split("\n")
      .filter((line) => line.startsWith("#")).length;

    const introLength = (output as string).split(STEPS_TO_COMPLETE_SIGIL)[0]!
      .length;

    return [
      {
        label: "Path",
        value: `${input.sectionPath}/${input.lessonPath}`,
      },
      {
        label: "Article",
        value: output,
      },
      {
        label: "Stats",
        value: [
          `- Number of headings: ${numberOfHeadings}`,
          `- Intro length: ${introLength}`,
        ].join("\n"),
      },
    ];
  },
  task: async (input, model) => {
    const filesWithoutReadme = input.textFiles.filter(
      (file) => !file.path.toLowerCase().endsWith("readme.md")
    );

    const agent = createTextWritingAgent({
      code: filesWithoutReadme,
      transcript: input.transcript,
      imageFiles: [],
      model: wrapAISDKModel(model) as unknown as LanguageModel,
      mode: "skill-building",
    });

    const result = await agent.generate({
      messages: await createModelMessagesForTextWritingAgent({
        messages: [
          {
            id: "1",
            parts: [
              {
                type: "text",
                text: "Go.",
              },
            ],
            role: "user",
          },
        ],
        imageFiles: [],
      }),
    });

    return result.text;
  },
  scorers: [
    {
      name: "Contains Steps To Complete",
      scorer: ({ output }) => {
        return (output as string).includes(STEPS_TO_COMPLETE_SIGIL) ? 1 : 0;
      },
    },
    {
      name: "Intro Length",
      scorer: ({ output }) => {
        const introLength = (output as string).split(
          STEPS_TO_COMPLETE_SIGIL
        )[0]!.length;

        return introLength < INTRO_MAX_LENGTH_IN_CHARS ? 1 : 0;
      },
    },
  ],
});
