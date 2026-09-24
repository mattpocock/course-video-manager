import { describe, it, expect } from "vitest";
import { windowsToWSL } from "./clip-service-handler.helpers";

describe("windowsToWSL", () => {
  it("converts a Windows drive path to its WSL mount", () => {
    expect(windowsToWSL("D:\\raw-footage\\2026-07-30_09-54-33.mkv")).toBe(
      "/mnt/d/raw-footage/2026-07-30_09-54-33.mkv"
    );
  });

  it("converts a Windows drive path written with forward slashes", () => {
    expect(windowsToWSL("C:/Users/matt/Videos/take.mkv")).toBe(
      "/mnt/c/Users/matt/Videos/take.mkv"
    );
  });

  it("leaves a macOS path from OBS untouched", () => {
    expect(
      windowsToWSL("/Users/joaocardoso/Movies/2026-09-24 20-44-35.mp4")
    ).toBe("/Users/joaocardoso/Movies/2026-09-24 20-44-35.mp4");
  });

  it("leaves a Linux path untouched", () => {
    expect(windowsToWSL("/home/matt/Videos/take.mkv")).toBe(
      "/home/matt/Videos/take.mkv"
    );
  });
});
