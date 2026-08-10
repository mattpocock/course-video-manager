import { describe, it, expect } from "vitest";
import {
  SOURCE_HIERARCHY,
  ARTICLE_SOURCE_HIERARCHY,
  PROJECT_SOURCE_HIERARCHY,
  SKILL_BUILDING_SOURCE_HIERARCHY,
  REFINE_SOURCE_HIERARCHY,
} from "./source-hierarchy";

describe("SOURCE_HIERARCHY", () => {
  it("names the three rungs in fidelity order", () => {
    expect(SOURCE_HIERARCHY).toContain("beats");
    expect(SOURCE_HIERARCHY).toContain("script");
    expect(SOURCE_HIERARCHY).toContain("transcript");
    expect(SOURCE_HIERARCHY.indexOf("beats")).toBeLessThan(
      SOURCE_HIERARCHY.indexOf("script")
    );
  });

  it("states the transcript is the scope ceiling, not a mandate", () => {
    expect(SOURCE_HIERARCHY).toContain("ceiling, not a mandate");
    expect(SOURCE_HIERARCHY).toContain("was not taught");
  });

  it("keeps selection within the transcript boundary", () => {
    expect(SOURCE_HIERARCHY).toContain("tangents, repetition and dead air");
  });

  it("limits the script to spelling and naming", () => {
    expect(SOURCE_HIERARCHY).toContain("spelling and naming");
  });

  it("gives the transcript authority over leading words", () => {
    expect(SOURCE_HIERARCHY).toContain("leading words");
    expect(SOURCE_HIERARCHY).toContain("plausible mis-hearing");
    expect(SOURCE_HIERARCHY).toContain("renamed it on camera");
  });

  it("demotes beats to intended emphasis only", () => {
    expect(SOURCE_HIERARCHY).toContain("intended emphasis");
    expect(SOURCE_HIERARCHY).toContain(
      "not a source of content, scope or ordering"
    );
  });

  it("frames attached files as supporting material, never a source of claims", () => {
    expect(SOURCE_HIERARCHY).toContain("supporting material");
    expect(SOURCE_HIERARCHY).toContain("never themselves a source of claims");
  });

  it("tolerates missing lower rungs", () => {
    expect(SOURCE_HIERARCHY).toContain("may be absent");
  });

  it("does not tell the writer to follow the transcript's order", () => {
    expect(SOURCE_HIERARCHY).not.toContain("annotated transcript");
  });
});

describe("ARTICLE_SOURCE_HIERARCHY", () => {
  it("includes the shared hierarchy", () => {
    expect(ARTICLE_SOURCE_HIERARCHY).toContain(SOURCE_HIERARCHY);
  });

  it("adds the annotated-transcript clause", () => {
    expect(ARTICLE_SOURCE_HIERARCHY).toContain("annotated transcript");
    expect(ARTICLE_SOURCE_HIERARCHY).toContain("follow the transcript's order");
  });
});

describe("PROJECT_SOURCE_HIERARCHY", () => {
  it("includes the shared hierarchy", () => {
    expect(PROJECT_SOURCE_HIERARCHY).toContain(SOURCE_HIERARCHY);
  });

  it("exempts the diff, which defines the steps", () => {
    expect(PROJECT_SOURCE_HIERARCHY).toContain("diff");
    expect(PROJECT_SOURCE_HIERARCHY).toContain("defines the steps");
  });
});

describe("SKILL_BUILDING_SOURCE_HIERARCHY", () => {
  it("includes the shared hierarchy", () => {
    expect(SKILL_BUILDING_SOURCE_HIERARCHY).toContain(SOURCE_HIERARCHY);
  });

  it("exempts the TODO comments, which define the steps", () => {
    expect(SKILL_BUILDING_SOURCE_HIERARCHY).toContain("TODO comments");
    expect(SKILL_BUILDING_SOURCE_HIERARCHY).toContain("defines the steps");
  });

  it("keeps the transcript in charge of the teaching around the steps", () => {
    expect(SKILL_BUILDING_SOURCE_HIERARCHY).toContain(
      "transcript still governs the teaching"
    );
  });
});

describe("REFINE_SOURCE_HIERARCHY", () => {
  it("includes the shared hierarchy", () => {
    expect(REFINE_SOURCE_HIERARCHY).toContain(SOURCE_HIERARCHY);
  });

  it("forbids cutting README content absent from the transcript", () => {
    expect(REFINE_SOURCE_HIERARCHY).toContain("never cut a section");
  });

  it("narrows the ladder to wording on a reformatting pass", () => {
    expect(REFINE_SOURCE_HIERARCHY).toContain("ladder to wording only");
  });
});
