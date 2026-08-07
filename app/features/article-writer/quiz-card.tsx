"use client";

import { cn } from "@/lib/utils";
import { AlertTriangleIcon, CheckIcon, XIcon } from "lucide-react";
import type { QuizCardQuestion } from "./quiz-markdown";

/**
 * The preview's stand-in for a quiz on aihero.dev.
 *
 * Deliberately static and fully revealed: every choice, the correct one marked,
 * the explanation open. The author is proofreading the quiz, not sitting it —
 * hiding the explanation behind a click would mean clicking every question to
 * read the body.
 */
export function QuizCard({
  questions,
  onRemoveQuestion,
}: {
  questions: QuizCardQuestion[];
  onRemoveQuestion?: (questionStart: number) => void;
}) {
  if (questions.length === 0) return null;

  return (
    <div className="my-6 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Quiz
      </div>
      {questions.map((question) => (
        <QuizQuestionCard
          key={question.start}
          question={question}
          onRemove={onRemoveQuestion}
        />
      ))}
    </div>
  );
}

function QuizQuestionCard({
  question,
  onRemove,
}: {
  question: QuizCardQuestion;
  onRemove?: (questionStart: number) => void;
}) {
  const { data, problems } = question;
  const correct = new Set(
    data ? (Array.isArray(data.correct) ? data.correct : [data.correct]) : []
  );

  return (
    <div className="relative rounded-md border border-border bg-background p-3">
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove question"
          title="Remove question"
          onClick={() => onRemove(question.start)}
          className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm hover:text-destructive"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}

      {data ? (
        <>
          <div className="pr-7 font-medium">{data.question}</div>
          <ul className="mt-2 space-y-1">
            {(data.choices ?? []).map((choice) => (
              <li
                key={choice.answer}
                className={cn(
                  "flex items-start gap-2 rounded-sm px-2 py-1 text-sm",
                  correct.has(choice.answer)
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "text-muted-foreground"
                )}
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  {correct.has(choice.answer) ? (
                    <CheckIcon className="size-3.5" />
                  ) : (
                    <span className="size-2 rounded-full border border-current" />
                  )}
                </span>
                <span>{choice.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">
            {data.answer}
          </div>
          <div className="mt-2 font-mono text-[11px] text-muted-foreground/70">
            {data.id}
          </div>
        </>
      ) : (
        <div className="pr-7 text-sm text-muted-foreground">
          This question could not be read.
        </div>
      )}

      {problems.length > 0 ? (
        <ul className="mt-2 space-y-1 rounded-sm bg-destructive/10 p-2 text-xs text-destructive">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-1.5">
              <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
              <span>{problem}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
