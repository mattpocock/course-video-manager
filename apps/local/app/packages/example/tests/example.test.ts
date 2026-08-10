import { expect, it } from "vitest";

// Tests exercise the package through its ENTRY POINTS, exactly like any outside
// caller — import `../index`, never `../lib/*`.
import { greet } from "../index";

it("greets through the public entry point", () => {
  expect(greet("world")).toBe("HELLO WORLD!");
});
