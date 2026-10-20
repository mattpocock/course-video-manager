/**
 * THE PUBLISH BUTTON.
 *
 * The publish page has a single action, Publish, and this pure function
 * decides what it says and whether it can be pressed. The **Autofill** is a
 * hidden part of it (ADR 0024, amended): pressing Publish starts the Autofill
 * first when there are **Autofill Candidates**, and the Publish waits on it.
 * So the blockers the Autofill will clear never disable the button — only the
 * ones it leaves behind do, and those are the author's work.
 */

export type PublishAction =
  /** A **Pending Version** at rest — the recovery banner owns the page. */
  | { readonly kind: "hidden" }
  | {
      readonly kind: "publish";
      readonly label: string;
      readonly enabled: boolean;
    };

export interface PublishActionInput {
  /** A crash-stranded Pending Version is waiting to be reconciled. */
  readonly pendingRecovery: boolean;
  /**
   * Anything in **Publish Readiness** that refuses a release and that the
   * Autofill will not clear (`splitAutofillClearable`'s `mine`).
   */
  readonly hasBlockers: boolean;
  /** A Published Version always carries a description. */
  readonly hasVersionDescription: boolean;
  readonly autofillRunning: boolean;
  readonly publishRunning: boolean;
}

const runningLabel = (input: PublishActionInput) => {
  if (input.autofillRunning) return "Filling…";
  if (input.publishRunning) return "Publishing…";
  return "Publish";
};

export const decidePublishAction = (
  input: PublishActionInput
): PublishAction => {
  // A stranded Pending Version is the only decision on the page: a second
  // Submit would collide with the at-most-one-pending invariant anyway.
  if (input.pendingRecovery) return { kind: "hidden" };

  // The label always describes what the button WOULD do, even when it can't.
  return {
    kind: "publish",
    label: runningLabel(input),
    enabled:
      !input.hasBlockers &&
      input.hasVersionDescription &&
      !input.publishRunning &&
      !input.autofillRunning,
  };
};
