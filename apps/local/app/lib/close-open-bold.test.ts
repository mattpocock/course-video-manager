import { describe, expect, it } from "vitest";
import { closeOpenBold } from "./close-open-bold";

describe("closeOpenBold", () => {
  it("makes bold that is still streaming in whole at every step", () => {
    const steps = [
      "Now the ",
      "Now the *",
      "Now the **",
      "Now the **impor",
      "Now the **important ",
      "Now the **important part*",
      "Now the **important part**",
      "Now the **important part** is",
    ].map(closeOpenBold);
    expect(steps).toEqual([
      "Now the ",
      "Now the ",
      "Now the",
      "Now the **impor**",
      "Now the **important** ",
      "Now the **important part**",
      "Now the **important part**",
      "Now the **important part** is",
    ]);
  });
});
