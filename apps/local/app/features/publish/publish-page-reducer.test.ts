import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialPublishPageState,
  publishPageReducer,
  readVersionBase,
  selectVersionName,
} from "./publish-page-reducer";

const page = () =>
  new ReducerTester(publishPageReducer, createInitialPublishPageState());

const context = (
  overrides: Partial<publishPageReducer.PublishContext> = {}
): publishPageReducer.PublishContext => ({
  courseId: "course-1",
  courseName: "Tiny Course",
  versionId: "version-7",
  baseSemver: readVersionBase("v1.2.3").baseSemver,
  placeholders: "p2",
  hasAutofillWork: true,
  ...overrides,
});

describe("publishPageReducer", () => {
  it("one press starts the Autofill and the Publish behind it from the form, then opens the Course", () => {
    const tester = page()
      .send({ type: "bump-level-clicked", level: "minor" })
      .send({ type: "description-edited", description: "  New lessons\n" })
      .send({ type: "include-todo-toggled", checked: false })
      .send({ type: "publish-clicked", context: context() });

    expect(tester.getState().publishStarted).toBe(true);
    expect(tester.getEffects()).toEqual([
      {
        type: "start-publish",
        courseId: "course-1",
        courseName: "Tiny Course",
        versionName: "v1.3.0",
        description: "New lessons",
        includeTodoLessons: false,
        placeholders: "p2",
        autofillVersionId: "version-7",
      },
      { type: "open-course", courseId: "course-1" },
    ]);
  });

  it("with nothing to fill, the Publish starts on its own", () => {
    const tester = page()
      .send({ type: "description-edited", description: "Fixes" })
      .send({
        type: "publish-clicked",
        context: context({ hasAutofillWork: false }),
      });

    expect(tester.getEffects()).toEqual([
      {
        type: "start-publish",
        courseId: "course-1",
        courseName: "Tiny Course",
        versionName: "v1.2.4",
        description: "Fixes",
        includeTodoLessons: true,
        placeholders: "p2",
        autofillVersionId: null,
      },
      { type: "open-course", courseId: "course-1" },
    ]);
  });

  it("once Publish is pressed the form is frozen and a second press starts nothing", () => {
    const tester = page()
      .send({ type: "description-edited", description: "Fixes" })
      .send({ type: "publish-clicked", context: context() })
      .resetExec()
      .send({ type: "bump-level-clicked", level: "major" })
      .send({ type: "description-edited", description: "Other" })
      .send({ type: "include-todo-toggled", checked: false })
      .send({ type: "publish-clicked", context: context() });

    expect(tester.getState()).toMatchObject({
      bumpLevel: "patch",
      description: "Fixes",
      includeTodoLessons: true,
    });
    expect(tester.getEffects()).toEqual([]);
  });

  it("re-reads Publish Readiness once when this Course's Publish settles while the page is open", () => {
    const tester = page()
      .send({ type: "publish-job-observed", running: true })
      .send({ type: "publish-job-observed", running: true })
      .send({ type: "publish-job-observed", running: false })
      .send({ type: "publish-job-observed", running: false });

    expect(tester.getEffects()).toEqual([{ type: "revalidate-readiness" }]);
  });

  it("a page opened with no Publish running never re-reads on its own", () => {
    const tester = page().send({
      type: "publish-job-observed",
      running: false,
    });

    expect(tester.getEffects()).toEqual([]);
  });

  it("the version is bumped from the previous semver, or from v0 when there is none", () => {
    const state = page()
      .send({ type: "bump-level-clicked", level: "major" })
      .getState();

    expect(readVersionBase("release-3")).toMatchObject({
      previousWasSemver: false,
    });
    expect(
      selectVersionName(state, readVersionBase("release-3").baseSemver)
    ).toBe("v1.0.0");
    expect(selectVersionName(state, readVersionBase(null).baseSemver)).toBe(
      "v1.0.0"
    );
    expect(selectVersionName(state, readVersionBase("v2.4.1").baseSemver)).toBe(
      "v3.0.0"
    );
  });
});
