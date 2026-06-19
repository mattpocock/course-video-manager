import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clampWidth,
  loadSidebarWidth,
  saveSidebarWidth,
} from "./course-agent-sidebar";

describe("clampWidth", () => {
  it("returns the value when within bounds", () => {
    expect(clampWidth(400)).toBe(400);
  });

  it("clamps to 320 minimum", () => {
    expect(clampWidth(200)).toBe(320);
    expect(clampWidth(0)).toBe(320);
    expect(clampWidth(-100)).toBe(320);
  });

  it("clamps to 640 maximum", () => {
    expect(clampWidth(800)).toBe(640);
    expect(clampWidth(641)).toBe(640);
  });

  it("accepts exact boundary values", () => {
    expect(clampWidth(320)).toBe(320);
    expect(clampWidth(640)).toBe(640);
  });
});

describe("loadSidebarWidth", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      clear: () => store.clear(),
    });
  });

  it("returns the default when nothing is stored", () => {
    expect(loadSidebarWidth()).toBe(400);
  });

  it("returns the stored value", () => {
    store.set("agent-sidebar-width", "500");
    expect(loadSidebarWidth()).toBe(500);
  });

  it("clamps stored values that are out of range", () => {
    store.set("agent-sidebar-width", "900");
    expect(loadSidebarWidth()).toBe(640);

    store.set("agent-sidebar-width", "100");
    expect(loadSidebarWidth()).toBe(320);
  });

  it("returns the default for non-numeric values", () => {
    store.set("agent-sidebar-width", "not-a-number");
    expect(loadSidebarWidth()).toBe(400);
  });
});

describe("saveSidebarWidth", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      clear: () => store.clear(),
    });
  });

  it("persists the width to localStorage", () => {
    saveSidebarWidth(500);
    expect(store.get("agent-sidebar-width")).toBe("500");
  });

  it("overwrites the previous value", () => {
    saveSidebarWidth(500);
    saveSidebarWidth(350);
    expect(store.get("agent-sidebar-width")).toBe("350");
  });
});
