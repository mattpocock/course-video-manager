import { describe, expect, it } from "vitest";
import {
  onlySearchChanged,
  searchPitches,
  searchVideos,
  withSearchQuery,
} from "./list-search";

const pitch = (title: string, description = "") => ({ title, description });

/** The search box on the Pitches, Standalone Videos and Shorts pages (#2512). */
describe("in-page search", () => {
  const pitches = [
    pitch("Effect for beginners", "A gentle start"),
    pitch("Zod deep dive", "Schemas and EFFECT-free validation"),
    pitch("TypeScript generics", "Inference tricks"),
  ];

  it("keeps a Pitch whose title or description has the query, in any case", () => {
    expect(searchPitches(pitches, "effect").map((p) => p.title)).toEqual([
      "Effect for beginners",
      "Zod deep dive",
    ]);
    expect(searchPitches(pitches, "  INFERENCE ").map((p) => p.title)).toEqual([
      "TypeScript generics",
    ]);
    expect(searchPitches(pitches, "nothing like this")).toEqual([]);
  });

  it("matches a Video or Short by title only", () => {
    const videos = [
      { id: "a", title: "Effect in ten minutes" },
      { id: "b", title: "Why I left Effect" },
      { id: "c", title: "Zod v4" },
    ];
    expect(searchVideos(videos, "EFFECT").map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("an empty box keeps today's list", () => {
    expect(searchPitches(pitches, "")).toEqual(pitches);
    expect(searchPitches(pitches, "   ")).toEqual(pitches);
  });

  it("writes the query to ?q= beside the other filters, and drops it when empty", () => {
    const params = new URLSearchParams("priority=1&shipped=1");
    const typed = withSearchQuery(params, "zod ");
    expect(typed.get("q")).toBe("zod ");
    expect(typed.get("priority")).toBe("1");
    expect(withSearchQuery(typed, "").has("q")).toBe(false);
  });

  it("typing loads nothing again; another page or filter does", () => {
    const at = (path: string) => new URL(path, "http://cvm");
    expect(onlySearchChanged(at("/pitches"), at("/pitches?q=zod"))).toBe(true);
    expect(
      onlySearchChanged(
        at("/pitches?priority=1&q=z"),
        at("/pitches?q=zo&priority=1")
      )
    ).toBe(true);
    expect(
      onlySearchChanged(at("/pitches?q=zod"), at("/pitches?q=zod&priority=1"))
    ).toBe(false);
    expect(onlySearchChanged(at("/pitches?q=zod"), at("/videos?q=zod"))).toBe(
      false
    );
    // A revalidation of the same URL (window focus, a fetcher) still loads.
    expect(onlySearchChanged(at("/videos?q=a"), at("/videos?q=a"))).toBe(false);
  });
});
