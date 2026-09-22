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

const render = (props: {
  beats: BeatListBeat[];
  showLearningGoals?: boolean;
  sectionLearningGoals?: BeatLearningGoalOption[];
}) =>
  renderToStaticMarkup(
    <BeatList
      video={{ id: "v1", beats: props.beats }}
      submitEvent={() => {}}
      isReadOnly={false}
      sectionLearningGoals={props.sectionLearningGoals ?? GOALS}
      showLearningGoals={props.showLearningGoals}
    />
  );

describe("BeatList", () => {
  it("names the Learning Goals a Beat serves", () => {
    const html = render({ beats: [beat({ learningGoalIds: ["g1"] })] });

    expect(html).toContain("Order a list without renumbering it");
  });

  it("drops the Learning Goal control when the caller turns it off", () => {
    const html = render({
      beats: [beat({ learningGoalIds: ["g1"] })],
      showLearningGoals: false,
    });

    expect(html).not.toContain("Order a list without renumbering it");
    expect(html).toContain("Why fractional indexing beats integer positions");
  });

  it("drops the Learning Goal warning too when it is turned off", () => {
    const warned = [beat({ warnings: [{ kind: "noLearningGoal" }] })];

    expect(render({ beats: warned })).toContain("Serves no Learning Goal");
    expect(render({ beats: warned, showLearningGoals: false })).not.toContain(
      "Serves no Learning Goal"
    );
  });
});
