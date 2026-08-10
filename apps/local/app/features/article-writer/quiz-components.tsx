"use client";

import { createContext, useContext } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import type { Options } from "react-markdown";
import { QuizCard } from "./quiz-card";
import { decodeQuizPayload, QUIZ_TAG_NAME } from "./quiz-markdown";

/**
 * What a rendered quiz needs beyond its own payload. It travels by context so
 * the component map below can stay a frozen module constant — see
 * {@link QUIZ_COMPONENTS}.
 */
export interface QuizRuntime {
  /** Cuts the question starting at this source offset. Absent means read-only. */
  onRemoveQuestion?: (questionStart: number) => void;
}

const RuntimeContext = createContext<QuizRuntime>({});

/** Wrap whatever renders the markdown to make the cards' X buttons live. */
export function QuizProvider({
  runtime,
  children,
}: {
  runtime: QuizRuntime;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  );
}

function QuizSlot(
  props: HTMLAttributes<HTMLElement> & Record<string, unknown>
) {
  const runtime = useContext(RuntimeContext);
  const payload = decodeQuizPayload((props.payload as string) ?? "");

  return (
    <QuizCard
      questions={payload.questions}
      onRemoveQuestion={runtime.onRemoveQuestion}
    />
  );
}

/**
 * The tag → component map handed to `AIResponse`. A module constant, and it
 * must stay one: react-markdown uses the mapped value as the React element
 * *type*, so a fresh object on each render unmounts and remounts every card.
 */
export const QUIZ_COMPONENTS = {
  [QUIZ_TAG_NAME]: QuizSlot as unknown,
} as Options["components"];
