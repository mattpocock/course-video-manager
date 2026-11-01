import { describe, expect, it, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialGlobalSearchState,
  globalSearchReducer,
} from "./global-search-reducer";
import { globalSearchRows } from "./global-search-selectors";

type Hit = globalSearchReducer.Hit;

const pitch: Hit = {
  kind: "pitch",
  id: "p1",
  title: "Effect in anger",
  field: "title",
  snippet: "Effect in anger",
};
const short: Hit = {
  kind: "video",
  id: "v-short",
  format: "short",
  title: "effect-short.mp4",
  field: "title",
  snippet: "effect-short.mp4",
};
const lesson: Hit = {
  kind: "lesson",
  id: "l1",
  courseId: "c1",
  sectionId: "s1",
  path: "Effect basics",
  field: "title",
  snippet: "Effect basics",
};
const course: Hit = {
  kind: "course",
  id: "c1",
  courseId: "c1",
  name: "Effect Course",
  field: "name",
  snippet: "Effect Course",
};

const tester = () =>
  new ReducerTester(globalSearchReducer, createInitialGlobalSearchState());

describe("globalSearchReducer", () => {
  it("the shortcut opens it empty, and the same key closes it", () => {
    const t = tester()
      .send({ type: "shortcut-pressed" })
      .send({ type: "query-typed", query: "eff" });
    expect(t.getState()).toMatchObject({ open: true, query: "eff" });

    t.send({ type: "shortcut-pressed" });
    expect(t.getState().open).toBe(false);

    // Opened again, from the sidebar this time: a fresh, empty box.
    t.send({ type: "search-button-clicked" });
    expect(t.getState()).toMatchObject({
      open: true,
      query: "",
      status: "idle",
      hits: [],
    });
  });

  it("fast typing replaces the pending search, and a late result for the old query is ignored", () => {
    const t = tester();
    const first = fromPartial<NonNullable<globalSearchReducer.State["search"]>>(
      {
        type: "search",
      }
    );
    vi.mocked(t.getExec()).mockReturnValueOnce(first);

    t.send({ type: "shortcut-pressed" })
      .send({ type: "query-typed", query: "ef" })
      .send({ type: "query-typed", query: "effect" });

    expect(t.getEffects()).toEqual([
      { type: "search", query: "ef" },
      { type: "search", query: "effect" },
    ]);
    // The second search cancels the first one's timer and request.
    expect(t.getExec().replace).toHaveBeenLastCalledWith(first, {
      type: "search",
      query: "effect",
    });
    expect(t.getState().status).toBe("searching");

    t.send({ type: "results-arrived", query: "ef", hits: [pitch] });
    expect(t.getState()).toMatchObject({ status: "searching", hits: [] });

    t.send({ type: "results-arrived", query: "effect", hits: [course] });
    expect(t.getState()).toMatchObject({ status: "done", hits: [course] });
  });

  it("arrows and Enter open the picked result through its deep link", () => {
    const t = tester()
      .send({ type: "shortcut-pressed" })
      .send({ type: "query-typed", query: "effect" })
      .send({
        type: "results-arrived",
        query: "effect",
        hits: [course, lesson, short, pitch],
      });

    // Grouped by kind: Pitches, Videos, Shorts, Courses, Sections, Lessons.
    expect(globalSearchRows(t.getState()).map((r) => r.hit.id)).toEqual([
      "p1",
      "v-short",
      "c1",
      "l1",
    ]);

    t.resetExec()
      .send({ type: "arrow-pressed", direction: "down" })
      .send({ type: "result-picked", index: t.getState().highlighted });
    expect(t.getEffects()).toEqual([
      { type: "navigate", path: "/videos/v-short/edit" },
    ]);
    expect(t.getState().open).toBe(false);

    // A Lesson opens its Section page at the Lesson; a Pitch its own page.
    const reopen = () =>
      t
        .resetExec()
        .send({ type: "shortcut-pressed" })
        .send({ type: "query-typed", query: "effect" })
        .send({
          type: "results-arrived",
          query: "effect",
          hits: [course, lesson, short, pitch],
        })
        .resetExec();

    reopen().send({ type: "result-picked", index: 3 });
    expect(t.getEffects()).toEqual([
      { type: "navigate", path: "/courses/c1/sections/s1#l1" },
    ]);

    reopen().send({ type: "result-picked", index: 0 });
    expect(t.getEffects()).toEqual([{ type: "navigate", path: "/pitches/p1" }]);
  });
});
