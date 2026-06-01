import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SIDEBAR_PATH = path.join(
  __dirname,
  "..",
  "components",
  "app-sidebar.tsx"
);

describe("sidebar responsive behavior", () => {
  it("hides the rail on small screens", () => {
    const content = fs.readFileSync(SIDEBAR_PATH, "utf-8");
    expect(content).toMatch(/hidden md:flex/);
  });

  it("shows the floating navigation on small screens when in rail mode", () => {
    const content = fs.readFileSync(SIDEBAR_PATH, "utf-8");
    expect(content).toMatch(/md:hidden/);
  });
});
