import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BeatList, type BeatListBeat } from "./beat-list";
import type { BeatLearningGoalOption } from "./beat-learning-goals-picker";

const beat = (overrides: Partial<BeatListBeat> = {}): BeatListBeat => ({
  id: "b1",
  videoId: "v1",
  kind: "walkthrough",
  title: "Why fractional indexing beats integer positions",
  description: "",
  order: "a0",
  learningGoalIds: [],
  ...overrides,
});

const GOALS: BeatLearningGoalOption[] = [
  { id: "g1", title: "Order a list without renumbering it" },
];

/**
 * Omitting `sectionLearningGoals` means exactly that — the no-Section-context
 * callers (the video editor's Beats tab, the pitch page), which get the bare
 * warning icon rather than the picker. Spell the key out to get the picker.
 */
const render = (props: {
  beats: BeatListBeat[];
  showLearningGoals?: boolean;
  isReadOnly?: boolean;
  sectionLearningGoals?: BeatLearningGoalOption[];
}) =>
  renderToStaticMarkup(
    <BeatList
      video={{ id: "v1", beats: props.beats }}
      submitEvent={() => {}}
      isReadOnly={props.isReadOnly ?? false}
      sectionLearningGoals={props.sectionLearningGoals}
      showLearningGoals={props.showLearningGoals}
    />
  );

describe("BeatList", () => {
  it("names the Learning Goals a Beat serves", () => {
    const html = render({
      beats: [beat({ learningGoalIds: ["g1"] })],
      sectionLearningGoals: GOALS,
    });

    expect(html).toContain("Order a list without renumbering it");
  });

  it("drops the Learning Goal picker when the caller turns it off", () => {
    const html = render({
      beats: [beat({ learningGoalIds: ["g1"] })],
      sectionLearningGoals: GOALS,
      showLearningGoals: false,
    });

    expect(html).not.toContain("Order a list without renumbering it");
    expect(html).toContain("Why fractional indexing beats integer positions");
  });

  it("drops the picker's warning too when it is turned off", () => {
    const beats = [beat({ warnings: [{ kind: "noLearningGoal" }] })];

    expect(render({ beats, sectionLearningGoals: GOALS })).toContain(
      "Serves no Learning Goal"
    );
    expect(
      render({ beats, sectionLearningGoals: GOALS, showLearningGoals: false })
    ).not.toContain("Serves no Learning Goal");
  });

  it("flags a warning with the bare icon where there is no Section context", () => {
    // The video editor's Beats tab and the pitch page pass no
    // `sectionLearningGoals`: no picker, but the warning is not silent.
    const beats = [beat({ warnings: [{ kind: "noLearningGoal" }] })];

    expect(render({ beats })).toContain("Serves no Learning Goal");
    expect(render({ beats, showLearningGoals: false })).not.toContain(
      "Serves no Learning Goal"
    );
  });

  it("flags a warning with the bare icon while a capture is read-only", () => {
    // Section context, but editing is off, so the picker gives way to the
    // icon — and `showLearningGoals` still hides it.
    const beats = [beat({ warnings: [{ kind: "noLearningGoal" }] })];

    expect(
      render({ beats, sectionLearningGoals: GOALS, isReadOnly: true })
    ).toContain("Serves no Learning Goal");
    expect(
      render({
        beats,
        sectionLearningGoals: GOALS,
        isReadOnly: true,
        showLearningGoals: false,
      })
    ).not.toContain("Serves no Learning Goal");
  });

  it("renders no Learning Goal control at all for an unwarned, ungoaled Beat", () => {
    const html = render({ beats: [beat()] });

    expect(html).not.toContain("Serves no Learning Goal");
    expect(html).toContain("Why fractional indexing beats integer positions");
  });
});
