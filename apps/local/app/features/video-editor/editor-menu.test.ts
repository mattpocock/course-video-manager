import { describe, expect, it } from "vitest";
import { Link } from "lucide-react";
import {
  layoutActionMenu,
  type ActionMenuGroups,
  type LaidOutPicker,
} from "@/features/action-menu/action-menu-model";
import {
  videoMenuGroups,
  type VideoMenuActions,
} from "@/features/video-menu/video-menu";
import {
  editorVideoMenuGroups,
  LANDSCAPE_LEAVES_OUT,
  SHORT_LEAVES_OUT,
} from "./editor-menu";

const run = () => {};
const copyLink = { label: "Copy Link", icon: Link, onSelect: run };

/**
 * Every action a Video menu knows. `Required` makes a new action in
 * `VideoMenuActions` fail to compile here until it is added, so it cannot
 * slip past the parity check below.
 */
const everyAction: Required<VideoMenuActions> = {
  openTeleprompter: run,
  openDiagramPlayground: run,
  reference: { candidates: [{ id: "v2", title: "Other Video" }], open: run },
  revealInFileSystem: run,
  openInVSCode: run,
  rename: run,
  editLessonBody: run,
  editScript: run,
  autofillDescription: run,
  autofillChapters: run,
  unarchive: run,
  silenceLength: { value: "short", onValueChange: run },
  addBeat: run,
  addNote: run,
  duplicate: run,
  addVideoToLesson: run,
  createConcatenatedVideo: run,
  newShort: run,
  moveToLesson: run,
  moveToCourse: run,
  export: run,
  renderVerticalShort: run,
  retranscribeAllClips: run,
  postShort: run,
  postToYouTube: run,
  postToTikTok: run,
  copyTranscript: run,
  copyYouTubeChapters: run,
  copyLogPath: run,
  purgeExport: run,
  archive: run,
};

/**
 * Every action a menu offers, by label: the leaves inside submenus and not
 * the submenus themselves, which only group them ("Create ▸").
 */
const labels = (groups: ActionMenuGroups, appendToCopy = [copyLink]) =>
  layoutActionMenu(groups, appendToCopy).flatMap((g) =>
    g.items.flatMap((item) =>
      item.kind === "submenu"
        ? item.items.map((leaf) => leaf.label)
        : [item.label]
    )
  );

const topLevel = (groups: ActionMenuGroups) =>
  layoutActionMenu(groups, [copyLink]).flatMap((g) => g.items);

const labelsOf = (keys: string[]) =>
  keys.flatMap((key) =>
    labels(
      videoMenuGroups({
        [key]: everyAction[key as keyof VideoMenuActions],
      }),
      []
    )
  );

describe("the video editors' Actions menu", () => {
  const landscape = editorVideoMenuGroups("landscape", everyAction);
  const short = editorVideoMenuGroups("short", everyAction);

  it("offers a Short everything the landscape editor offers, except the listed exclusions", () => {
    const leftOut = new Set(labelsOf(Object.keys(SHORT_LEAVES_OUT)));
    const shortLabels = new Set(labels(short));
    const missing = labels(landscape).filter(
      (label) => !leftOut.has(label) && !shortLabels.has(label)
    );
    expect(missing).toEqual([]);
  });

  it("names only exclusions the landscape editor really offers, each with a reason", () => {
    const landscapeLabels = new Set(labels(landscape));
    for (const [key, reason] of Object.entries(SHORT_LEAVES_OUT)) {
      expect(reason.length).toBeGreaterThan(0);
      for (const label of labelsOf([key])) {
        expect(landscapeLabels, `${key} → ${label}`).toContain(label);
      }
    }
    expect(labels(short)).not.toContain("New Short");
  });

  it("puts the Short's Silence Length in its menu, fixed while a take records", () => {
    const picker = (groups: ActionMenuGroups) =>
      topLevel(groups).find(
        (item): item is LaidOutPicker =>
          item.kind === "picker" && item.label === "Set Silence Length"
      );
    expect(picker(short)?.value).toBe("short");
    expect(picker(short)?.runs[0]?.options.map((o) => o.label)).toEqual([
      "Short",
      "Long",
    ]);
    expect(picker(landscape)).toBeUndefined();

    const recording = editorVideoMenuGroups("short", {
      ...everyAction,
      silenceLength: { value: "long", onValueChange: run, disabled: true },
    });
    expect(picker(recording)?.runs[0]?.options.every((o) => o.disabled)).toBe(
      true
    );
  });

  it("keeps both menus to ten top-level entries (CODING_STANDARDS.md rule 9)", () => {
    // The actions an editor really has: a Lesson's Video, and a Short.
    const {
      addBeat,
      editScript,
      unarchive,
      moveToLesson,
      moveToCourse,
      purgeExport,
      archive,
      ...editorActions
    } = everyAction;
    void [
      addBeat,
      editScript,
      unarchive,
      moveToLesson,
      moveToCourse,
      purgeExport,
      archive,
    ];
    expect(
      topLevel(editorVideoMenuGroups("landscape", editorActions)).length
    ).toBeLessThanOrEqual(10);
    expect(
      topLevel(editorVideoMenuGroups("short", editorActions)).length
    ).toBeLessThanOrEqual(10);
  });

  it("leaves posting and the Silence Length picker out of the landscape menu", () => {
    const landscapeLabels = labels(landscape);
    for (const label of labelsOf(Object.keys(LANDSCAPE_LEAVES_OUT))) {
      expect(landscapeLabels).not.toContain(label);
    }
  });
});
