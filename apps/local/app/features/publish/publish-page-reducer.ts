import type { EffectReducer } from "use-effect-reducer";
import type { PlaceholderFloorBand } from "@/packages/course-json/client";
import {
  bumpSemver,
  formatSemver,
  parseSemver,
  ZERO_SEMVER,
  type BumpLevel,
  type Semver,
} from "@/lib/semver";

/**
 * The publish page: the release form, the one press that starts the Publish
 * (with the Autofill queued first when there is anything to fill), and
 * re-reading Publish Readiness when this Course's Publish settles. See
 * docs/FRONTEND_STATE.md.
 */
export namespace publishPageReducer {
  export interface State {
    bumpLevel: BumpLevel;
    description: string;
    includeTodoLessons: boolean;
    /** Publish was pressed in this tab; the form is frozen from here on. */
    publishStarted: boolean;
    /**
     * This Course's Publish Job was last seen running, so the next time it is
     * seen settled the page re-reads Publish Readiness.
     */
    publishWasRunning: boolean;
  }

  /** What the page knew about the Course when Publish was pressed. */
  export interface PublishContext {
    courseId: string;
    courseName: string;
    /** The latest Version: the one the Autofill fills in. */
    versionId: string;
    /** The previous Version's semver, or v0.0.0 (see `readVersionBase`). */
    baseSemver: Semver;
    placeholders: PlaceholderFloorBand;
    /** There are Autofill Candidates, so the Autofill runs first. */
    hasAutofillWork: boolean;
  }

  export type Action =
    | { type: "bump-level-clicked"; level: BumpLevel }
    | { type: "description-edited"; description: string }
    | { type: "include-todo-toggled"; checked: boolean }
    | { type: "publish-clicked"; context: PublishContext }
    /** The jobs list reported whether this Course's Publish is running. */
    | { type: "publish-job-observed"; running: boolean };

  export type Effect =
    | {
        type: "start-publish";
        courseId: string;
        courseName: string;
        versionName: string;
        description: string;
        includeTodoLessons: boolean;
        placeholders: PlaceholderFloorBand;
        /**
         * Start the Autofill on this Version first, and queue the Publish
         * behind it (ADR 0024). `null` when there is nothing to fill.
         */
        autofillVersionId: string | null;
      }
    | { type: "open-course"; courseId: string }
    | { type: "revalidate-readiness" };
}

export const createInitialPublishPageState = (): publishPageReducer.State => ({
  bumpLevel: "patch",
  description: "",
  includeTodoLessons: true,
  publishStarted: false,
  publishWasRunning: false,
});

/**
 * The version name is never free-typed: it is a lowercase-'v' semver bumped
 * from the previous published version, so the UI can only produce a valid
 * semver (matching the CLI's contract). A non-semver previous name, or a
 * first-ever publish, starts from v0.0.0.
 */
export const readVersionBase = (
  previousVersionName: string | null
): { baseSemver: Semver; previousWasSemver: boolean } => {
  if (!previousVersionName)
    return { baseSemver: ZERO_SEMVER, previousWasSemver: true };
  const parsed = parseSemver(previousVersionName);
  return {
    baseSemver: parsed ?? ZERO_SEMVER,
    previousWasSemver: parsed !== null,
  };
};

export const selectVersionName = (
  state: publishPageReducer.State,
  baseSemver: Semver
) => formatSemver(bumpSemver(baseSemver, state.bumpLevel));

export const publishPageReducer: EffectReducer<
  publishPageReducer.State,
  publishPageReducer.Action,
  publishPageReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "bump-level-clicked":
      if (state.publishStarted) return state;
      return { ...state, bumpLevel: action.level };
    case "description-edited":
      if (state.publishStarted) return state;
      return { ...state, description: action.description };
    case "include-todo-toggled":
      if (state.publishStarted) return state;
      return { ...state, includeTodoLessons: action.checked };
    case "publish-clicked": {
      if (state.publishStarted) return state;
      const { context } = action;
      exec({
        type: "start-publish",
        courseId: context.courseId,
        courseName: context.courseName,
        versionName: selectVersionName(state, context.baseSemver),
        description: state.description.trim(),
        includeTodoLessons: state.includeTodoLessons,
        placeholders: context.placeholders,
        autofillVersionId: context.hasAutofillWork ? context.versionId : null,
      });
      // Progress shows in the global upload progress, on the Course page.
      exec({ type: "open-course", courseId: context.courseId });
      return { ...state, publishStarted: true };
    }
    case "publish-job-observed":
      if (action.running) {
        if (state.publishWasRunning) return state;
        return { ...state, publishWasRunning: true };
      }
      if (!state.publishWasRunning) return state;
      // The Publish settled while the page was open (a failed Autofill fails
      // it too). An interrupted one may have left a Pending Version, and the
      // Promote / Discard banner reads it from the loader.
      exec({ type: "revalidate-readiness" });
      return { ...state, publishWasRunning: false };
  }
};
