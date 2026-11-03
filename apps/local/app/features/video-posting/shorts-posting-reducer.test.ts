import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialShortsPostingState,
  selectCanAdd,
  selectDescriptionRequest,
  shortsPostingReducer,
} from "./shorts-posting-reducer";

const modal = (videoTitle = "Zod in 60 seconds") =>
  new ReducerTester(
    shortsPostingReducer,
    createInitialShortsPostingState(videoTitle)
  );

const QUEUED: shortsPostingReducer.Verdict = {
  verdict: "queued",
  reason: null,
  goesOutAt: "Tue 2026-11-03 13:00",
};

/** The modal opened on short-1, with the Video's description loaded. */
const opened = (description = "Learn Zod", videoTitle?: string) =>
  modal(videoTitle).send({ type: "modal-opened", videoId: "short-1" }).send({
    type: "queue-preview-loaded",
    videoId: "short-1",
    description,
    verdict: QUEUED,
  });

const OPEN_EFFECTS = [
  { type: "load-posted-status", videoId: "short-1" },
  { type: "load-queue-preview", videoId: "short-1" },
];

describe("shortsPostingReducer", () => {
  it("opens on the Video's description and when the Short would go out", () => {
    const tester = opened();

    expect(tester.getState()).toMatchObject({
      description: "Learn Zod",
      verdict: QUEUED,
    });
    expect(selectCanAdd(tester.getState())).toBe(true);
    expect(tester.getEffects()).toEqual(OPEN_EFFECTS);
  });

  it("Add to Posting Queue sends the title and description, and starts no posting Job", () => {
    const tester = opened(" Learn Zod \n")
      .send({ type: "title-edited", title: "  Zod tips  " })
      .send({ type: "add-to-queue-clicked", videoId: "short-1" })
      .send({ type: "add-to-queue-clicked", videoId: "short-1" })
      .send({
        type: "add-to-queue-answered",
        videoId: "short-1",
        verdict: { ...QUEUED, goesOutAt: "Wed 2026-11-04 13:00" },
      });

    expect(tester.getState().adding).toBe(false);
    expect(tester.getEffects()).toEqual([
      ...OPEN_EFFECTS,
      {
        type: "add-to-posting-queue",
        videoId: "short-1",
        title: "Zod tips",
        description: "Learn Zod",
      },
      { type: "close-modal" },
      { type: "report-queued", videoId: "short-1" },
      {
        type: "show-toast",
        title: "Added to the Posting Queue",
        description: '"Zod tips" goes out Wed 2026-11-04 13:00 (UK time)',
      },
    ]);
  });

  it("a refusal from the Posting Queue is shown, and the modal stays open", () => {
    const refused: shortsPostingReducer.Verdict = {
      verdict: "refused",
      reason: "it is already in the Posting Queue (queued)",
      goesOutAt: null,
    };
    const tester = opened()
      .send({ type: "add-to-queue-clicked", videoId: "short-1" })
      .send({
        type: "add-to-queue-answered",
        videoId: "short-1",
        verdict: refused,
      });

    expect(tester.getState()).toMatchObject({
      adding: false,
      verdict: refused,
    });
    expect(tester.getEffects().slice(OPEN_EFFECTS.length + 1)).toEqual([
      {
        type: "show-error",
        title: "Not queued: it is already in the Posting Queue (queued)",
      },
    ]);
  });

  it("is refused with the default title or no description, before asking the server", () => {
    const tester = opened("Learn Zod", "Short 7/16/2026")
      .send({ type: "add-to-queue-clicked", videoId: "short-1" })
      .send({ type: "title-edited", title: "Zod tips" })
      .send({ type: "description-edited", description: "  " })
      .send({ type: "add-to-queue-clicked", videoId: "short-1" });

    expect(tester.getState().adding).toBe(false);
    expect(tester.getEffects().slice(OPEN_EFFECTS.length)).toEqual([
      {
        type: "show-error",
        title:
          "Rename this short before queueing it — it still has its default title.",
      },
      { type: "show-error", title: "Description is required" },
    ]);
  });

  it("a typed description is saved on the Video on blur, then the verdict is read again", () => {
    const tester = opened("")
      .send({ type: "text-generation-failed", field: "description" })
      .send({ type: "description-blurred", videoId: "short-1" })
      .send({ type: "description-edited", description: " Learn Zod " })
      .send({ type: "description-blurred", videoId: "short-1" })
      .send({
        type: "description-saved",
        videoId: "short-1",
        description: "Learn Zod",
      })
      .send({ type: "description-blurred", videoId: "short-1" });

    expect(tester.getEffects()).toEqual([
      ...OPEN_EFFECTS,
      {
        type: "generate-text",
        field: "description",
        request: selectDescriptionRequest("short-1"),
      },
      { type: "show-error", title: "Failed to generate text" },
      {
        type: "save-description",
        videoId: "short-1",
        description: "Learn Zod",
      },
      { type: "load-queue-preview", videoId: "short-1" },
    ]);
  });

  it("a blank description is generated once per mount, then shown and saved on the Video", () => {
    const tester = opened("")
      .send({ type: "text-generated", field: "description", text: "A Short" })
      .send({ type: "modal-closed" })
      .send({ type: "modal-opened", videoId: "short-1" })
      .send({
        type: "queue-preview-loaded",
        videoId: "short-1",
        description: "",
        verdict: QUEUED,
      });

    expect(tester.getEffects()).toEqual([
      ...OPEN_EFFECTS,
      {
        type: "generate-text",
        field: "description",
        request: selectDescriptionRequest("short-1"),
      },
      { type: "save-description", videoId: "short-1", description: "A Short" },
      ...OPEN_EFFECTS,
    ]);
  });

  it("converted short links replace the description and are saved on the Video", () => {
    const tester = opened("See https://www.aihero.dev/zod")
      .send({ type: "convert-short-links-clicked" })
      .send({
        type: "short-links-created",
        links: [
          {
            url: "https://www.aihero.dev/zod",
            shortLinkUrl: "https://aihero.dev/s/zod",
          },
        ],
      });

    expect(tester.getState().description).toBe("See https://aihero.dev/s/zod");
    expect(tester.getEffects().slice(OPEN_EFFECTS.length + 1)).toEqual([
      expect.objectContaining({ type: "show-toast", title: "Links converted" }),
      {
        type: "save-description",
        videoId: "short-1",
        description: "See https://aihero.dev/s/zod",
      },
    ]);
  });

  it("a renamed title is saved on blur, and a refused rename puts the saved title back", () => {
    const tester = modal()
      .send({ type: "title-blurred", videoId: "short-1" })
      .send({ type: "title-edited", title: " Zod tips " })
      .send({ type: "title-blurred", videoId: "short-1" })
      .send({ type: "rename-refused", reason: "name-taken" });

    expect(tester.getState().title).toBe("Zod in 60 seconds");
    expect(tester.getEffects()).toEqual([
      { type: "rename-short", videoId: "short-1", name: "Zod tips" },
      {
        type: "show-error",
        title: "That name is already taken in this lesson.",
      },
    ]);
  });

  it("late answers for a closed modal are ignored", () => {
    const tester = modal()
      .send({ type: "modal-opened", videoId: "short-1" })
      .send({ type: "modal-closed" })
      .send({
        type: "posted-status-loaded",
        videoId: "short-1",
        postedStatus: { youtube: true, tiktok: false },
      })
      .send({
        type: "queue-preview-loaded",
        videoId: "short-1",
        description: "",
        verdict: QUEUED,
      });

    expect(tester.getState()).toMatchObject({
      postedStatus: null,
      verdict: null,
      savedDescription: null,
    });
    expect(tester.getEffects()).toEqual(OPEN_EFFECTS);
  });
});
