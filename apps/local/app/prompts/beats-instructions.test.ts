import { describe, it, expect } from "vitest";
import { getBeatsSection } from "./beats-instructions";

describe("getBeatsSection", () => {
  it("returns empty string for empty beats", () => {
    expect(getBeatsSection("")).toBe("");
  });

  it("returns empty string for whitespace-only beats", () => {
    expect(getBeatsSection("  \n ")).toBe("");
  });

  it("wraps the beats in <beats> tags under a Beat Plan heading", () => {
    const result = getBeatsSection("1. [Definition] Tracer bullet");
    expect(result).toContain("## Beat Plan");
    expect(result).toContain("<beats>");
    expect(result).toContain("1. [Definition] Tracer bullet");
    expect(result).toContain("</beats>");
  });

  it("demotes the beats to intended emphasis only", () => {
    const result = getBeatsSection("some beats");
    expect(result).toContain("intended emphasis");
    expect(result).toContain("not a source of content, scope or ordering");
  });

  it("tells the model a beat missing from the transcript was cut", () => {
    const result = getBeatsSection("some beats");
    expect(result).toContain("cut from the video");
  });

  it("no longer presents the beats as the video's flow and structure", () => {
    const result = getBeatsSection("some beats");
    expect(result).not.toContain("intended flow and structure");
  });
});
