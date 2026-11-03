import { describe, expect, it } from "vitest";
import { UNSAFE_ErrorResponseImpl as ErrorResponseImpl } from "react-router";
import { errorBoundaryCopy } from "./error-boundary-copy";

describe("errorBoundaryCopy", () => {
  it("shows the message a route answered a 503 with", () => {
    // What the browser gets for a loader's `data(message, { status: 503 })`:
    // no statusText, the message as `data`.
    const error = new ErrorResponseImpl(
      503,
      "",
      "Apply the pending migrations: pnpm db:migrate"
    );

    expect(errorBoundaryCopy(error)).toEqual({
      status: 503,
      title: "Error 503",
      description: "Apply the pending migrations: pnpm db:migrate",
    });
  });

  it("keeps the generic copy for a 500, whose message is never meant for the page", () => {
    const error = new ErrorResponseImpl(500, "", "Internal server error");

    expect(errorBoundaryCopy(error)).toEqual({
      status: 500,
      title: "Server error",
      description: "Something went wrong on our end. Please try again later.",
    });
  });
});
