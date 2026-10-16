import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  contextPanelReducer,
  createInitialContextPanelState,
} from "./context-panel-reducer";
import {
  selectContextSources,
  selectPromptTexts,
  type ContextSourcesInput,
} from "./context-panel-selectors";

const files = [
  { path: "readme.md", size: 400, defaultEnabled: true },
  { path: "src/index.ts", size: 800, defaultEnabled: false },
];
const chapters = [
  { id: "ch-1", name: "Intro", wordCount: 100 },
  { id: "ch-2", name: "Outro", wordCount: 50 },
];
const links = [
  { id: "link-1", title: "Docs", url: "https://example.com/docs" },
  { id: "link-2", title: "Repo", url: "https://example.com/repo" },
];

const remembered: contextPanelReducer.Remembered = {
  courseStructure: false,
  memory: false,
  beats: false,
  script: true,
  animatic: true,
  diagramText: true,
  disabledLinks: new Set(),
};

/** A posting route's panel: nothing is remembered. */
const postingRoute = () =>
  new ReducerTester(
    contextPanelReducer,
    createInitialContextPanelState({ files, chapters })
  );

/** The Article Writer's panel, with what it has stored. */
const articleWriter = (stored: Partial<contextPanelReducer.Remembered> = {}) =>
  new ReducerTester(
    contextPanelReducer,
    createInitialContextPanelState({
      files,
      chapters,
      memory: "Prefer short sentences.",
      remembered: { ...remembered, ...stored },
    })
  );

const sourcesInput: ContextSourcesInput = {
  chapters,
  transcript: "",
  files,
  links,
  courseStructure: null,
  pageFields: [],
  beatsText: "",
  scriptText: "",
  animaticText: "",
  diagramText: "",
};

describe("contextPanelReducer on a posting route", () => {
  it("starts with the default files and every chapter on, and a pasted file joins them", () => {
    const tester = postingRoute()
      .send({ type: "add-from-clipboard-clicked" })
      .send({ type: "file-pasted", path: "notes.md" })
      .send({ type: "modal-dismissed", modal: "paste-file" });

    const state = tester.getState();
    expect(state.enabledFiles).toEqual(new Set(["readme.md", "notes.md"]));
    expect(state.enabledSections).toEqual(new Set(["ch-1", "ch-2"]));
    expect(state.openModal).toBeNull();
    expect(tester.getEffects()).toEqual([]);
  });

  it("editing a file reads it first, and only the file clicked last opens", () => {
    const tester = postingRoute()
      .send({ type: "edit-file-clicked", videoId: "v1", path: "readme.md" })
      .send({ type: "edit-file-clicked", videoId: "v1", path: "src/index.ts" })
      .send({ type: "video-file-read", path: "readme.md", content: "old" });

    expect(tester.getState().openModal).toBeNull();

    tester.send({
      type: "video-file-read",
      path: "src/index.ts",
      content: "export {}",
    });

    expect(tester.getState().openModal).toBe("edit-file");
    expect(tester.getState().editingFile).toEqual({
      path: "src/index.ts",
      content: "export {}",
    });
    expect(tester.getEffects()).toEqual([
      { type: "read-video-file", videoId: "v1", path: "readme.md" },
      { type: "read-video-file", videoId: "v1", path: "src/index.ts" },
    ]);
  });

  it("a file that can't be read opens nothing, and the next try still can", () => {
    const tester = postingRoute()
      .send({ type: "edit-file-clicked", videoId: "v1", path: "readme.md" })
      .send({ type: "video-file-read-failed", path: "readme.md" })
      .send({ type: "video-file-read", path: "readme.md", content: "late" });

    expect(tester.getState().openModal).toBeNull();

    tester
      .send({ type: "edit-file-clicked", videoId: "v1", path: "readme.md" })
      .send({ type: "video-file-read", path: "readme.md", content: "# Hi" });

    expect(tester.getState().openModal).toBe("edit-file");
  });

  it("a dialog keeps what it was open on after it closes, and a late close leaves the open one alone", () => {
    const tester = postingRoute()
      .send({ type: "delete-file-clicked", path: "readme.md" })
      .send({ type: "modal-dismissed", modal: "delete-file" })
      .send({ type: "file-clicked", path: "src/index.ts" })
      .send({ type: "modal-dismissed", modal: "delete-file" });

    const state = tester.getState();
    expect(state.openModal).toBe("preview-file");
    expect(state.previewFilePath).toBe("src/index.ts");
    expect(state.fileToDelete).toBe("readme.md");
  });

  it("never stores the course structure toggle", () => {
    const tester = postingRoute().send({
      type: "course-structure-checkbox-changed",
      checked: true,
    });

    expect(tester.getState().includeCourseStructure).toBe(true);
    expect(tester.getEffects()).toEqual([]);
  });
});

describe("contextPanelReducer in the Article Writer", () => {
  it("stores each remembered toggle it flips, from the source or its item", () => {
    const tester = articleWriter({ memory: true })
      .send({
        type: "source-toggled",
        source: "memory",
        itemIds: ["memory"],
        atomic: true,
      })
      .send({
        type: "item-toggled",
        source: "courseStructure",
        itemId: "courseStructure",
        atomic: true,
      });

    const state = tester.getState();
    expect(state.memoryEnabled).toBe(false);
    expect(state.includeCourseStructure).toBe(true);
    expect(tester.getEffects()).toEqual([
      { type: "store-toggle", toggle: "memory", on: false },
      { type: "store-toggle", toggle: "courseStructure", on: true },
    ]);
  });

  it("a source's checkbox turns every item on unless all are on already", () => {
    const tester = articleWriter()
      .send({
        type: "item-toggled",
        source: "transcript",
        itemId: "ch-2",
        atomic: false,
      })
      .send({
        type: "source-toggled",
        source: "transcript",
        itemIds: ["ch-1", "ch-2"],
        atomic: false,
      });

    expect(tester.getState().enabledSections).toEqual(
      new Set(["ch-1", "ch-2"])
    );

    tester.send({
      type: "source-toggled",
      source: "transcript",
      itemIds: ["ch-1", "ch-2"],
      atomic: false,
    });

    expect(tester.getState().enabledSections).toEqual(new Set());
    expect(tester.getEffects()).toEqual([]);
  });

  it("links start on, a switched-off one is stored, and a link added later is on", () => {
    const tester = articleWriter().send({
      type: "item-toggled",
      source: "links",
      itemId: "link-1",
      atomic: false,
    });

    expect(tester.getEffects()).toEqual([
      { type: "store-disabled-links", linkIds: ["link-1"] },
    ]);

    const withNewLink = selectContextSources(tester.getState(), {
      ...sourcesInput,
      links: [
        ...links,
        { id: "link-3", title: "New", url: "https://example.com/new" },
      ],
    });
    expect(
      withNewLink
        .find((s) => s.key === "links")
        ?.items.map((item) => [item.id, item.on])
    ).toEqual([
      ["link-1", false],
      ["link-2", true],
      ["link-3", true],
    ]);
  });

  it("sends the memory only once it is switched on, as edited", () => {
    const tester = articleWriter();
    const texts = { beatsText: "", scriptText: "", animaticText: "" };

    expect(selectPromptTexts(tester.getState(), texts).memory).toBeUndefined();

    tester
      .send({
        type: "source-toggled",
        source: "memory",
        itemIds: ["memory"],
        atomic: true,
      })
      .send({ type: "memory-edited", text: "Prefer short paragraphs." });

    expect(selectPromptTexts(tester.getState(), texts).memory).toBe(
      "Prefer short paragraphs."
    );
  });
});
