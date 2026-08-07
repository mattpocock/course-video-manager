"use client";

import { Children, createContext, isValidElement, useContext } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import type { Options } from "react-markdown";
import { CommitEntryCard, CommitMapCard } from "./commit-map-card";

/**
 * No rewrite: a commit map goes into the preview exactly as authored.
 *
 * Quizzes are rewritten before parsing because `data={{ … }}` is a JS object
 * literal and an HTML attribute cannot hold one. A commit map carries a plain
 * `id="…"` attribute and text children, so the HTML parser takes it as it
 * stands — it only lowercases the tag names, which is why these keys are
 * `commitmap` and `commit`. Nothing here needs a scanner, and adding one for
 * symmetry with the quiz would buy nothing.
 */
export const COMMIT_MAP_TAG_NAME = "commitmap";
export const COMMIT_ENTRY_TAG_NAME = "commit";

/** Ids the surrounding map uses more than once. */
const DuplicateIdsContext = createContext<ReadonlySet<string>>(new Set());

type SlotProps = HTMLAttributes<HTMLElement> & Record<string, unknown>;

function childIds(children: ReactNode): string[] {
  return Children.toArray(children)
    .filter(isValidElement)
    .map((child) => (child.props as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * A blank line inside the block makes markdown parse the children early and
 * wrap them in a paragraph. Both shapes render, which is exactly why only one
 * of them is legal — the author cannot see the difference without being told.
 */
function hasParagraphChild(children: ReactNode): boolean {
  return Children.toArray(children).some(
    (child) => isValidElement(child) && child.type === "p"
  );
}

function CommitMapSlot(props: SlotProps) {
  const children = props.children as ReactNode;

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of childIds(children)) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }

  const problems = hasParagraphChild(children)
    ? [
        "This map has a blank line inside it. Close the gaps — the whole block must be one run of lines.",
      ]
    : [];

  return (
    <DuplicateIdsContext.Provider value={duplicates}>
      <CommitMapCard problems={problems}>{children}</CommitMapCard>
    </DuplicateIdsContext.Provider>
  );
}

function CommitEntrySlot(props: SlotProps) {
  const duplicates = useContext(DuplicateIdsContext);
  const rawId = props.id;
  const id = typeof rawId === "string" && rawId.length > 0 ? rawId : null;

  const problems: string[] = [];
  if (id === null) {
    problems.push(
      'This entry has no id. Give it the slug of the commit it names, or "main" for the course start.'
    );
  } else if (duplicates.has(id)) {
    problems.push("This id appears more than once in the map.");
  }

  return (
    <CommitEntryCard
      id={id}
      description={props.children as ReactNode}
      problems={problems}
    />
  );
}

/**
 * The tag → component map handed to `AIResponse`. A module constant for the
 * same reason {@link import("./quiz-components").QUIZ_COMPONENTS} is one:
 * react-markdown uses the mapped value as the React element *type*, so a fresh
 * object on each render remounts every card.
 */
export const COMMIT_MAP_COMPONENTS = {
  [COMMIT_MAP_TAG_NAME]: CommitMapSlot as unknown,
  [COMMIT_ENTRY_TAG_NAME]: CommitEntrySlot as unknown,
} as Options["components"];
