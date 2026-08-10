/**
 * ONE BUTTON, TWO LABELS.
 *
 * The publish page has a single action, and this pure function decides what it
 * says and whether it can be pressed. It exists apart from the page because
 * the rule is the interesting part: **Missing Chapters** is a blocking lint,
 * so the Publish button is disabled in exactly the situation the **Autofill**
 * exists to fix. A Publish that the gate is certain to refuse is never
 * started; the Autofill is offered instead, and the second press is the
 * author's.
 *
 * The Autofill never rolls on into a Publish. When a run settles the page
 * re-reads **Publish Readiness** and asks this function again — which is how
 * the same button comes back reading "Publish".
 */

export type PublishAction =
  /** A **Pending Version** at rest — the recovery banner owns the page. */
  | { readonly kind: "hidden" }
  | {
      readonly kind: "autofill";
      readonly label: string;
      readonly count: number;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "publish";
      readonly label: string;
      readonly enabled: boolean;
    };

export interface PublishActionInput {
  /** A crash-stranded Pending Version is waiting to be reconciled. */
  readonly pendingRecovery: boolean;
  /** **Autofill Candidates** under the currently selected to-do setting. */
  readonly autofillCandidateCount: number;
  /** Anything in **Publish Readiness** that refuses a release. */
  readonly hasBlockers: boolean;
  /** A Published Version always carries a description. */
  readonly hasVersionDescription: boolean;
  readonly autofillRunning: boolean;
  readonly publishRunning: boolean;
}

export const decidePublishAction = (
  input: PublishActionInput
): PublishAction => {
  // A stranded Pending Version is the only decision on the page: a second
  // Submit would collide with the at-most-one-pending invariant anyway.
  if (input.pendingRecovery) return { kind: "hidden" };

  if (input.autofillCandidateCount > 0) {
    const count = input.autofillCandidateCount;
    return {
      kind: "autofill",
      count,
      label: input.autofillRunning
        ? "Autofilling…"
        : `Autofill ${count} ${count === 1 ? "Video" : "Videos"}`,
      // Never while a Publish is live: it is writing to the same Draft.
      enabled: !input.autofillRunning && !input.publishRunning,
    };
  }

  // The label always describes what the button WOULD do, even when it can't:
  // with nothing left for the Autofill and blockers remaining, the only
  // honest word is "Publish", disabled.
  return {
    kind: "publish",
    label: input.publishRunning ? "Publishing…" : "Publish",
    enabled:
      !input.hasBlockers &&
      input.hasVersionDescription &&
      !input.publishRunning &&
      !input.autofillRunning,
  };
};
