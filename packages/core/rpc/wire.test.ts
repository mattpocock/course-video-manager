import { describe, expect, it } from "vitest";
import {
  CourseNameTakenError,
  NotFoundError,
  UnknownDBServiceError,
  VersionNotDraftError,
} from "../services/db-service-errors.js";
import { VERSION_NOT_DRAFT_MESSAGE } from "../services/version-not-draft-message.js";
import { AuthenticationError } from "./rpc-errors.js";
import { decodeRpcError, encodeRpcError, isRpcFailure } from "./wire.js";

describe("the error round trip", () => {
  it("rebuilds a domain NotFoundError as the same tagged error", () => {
    const original = new NotFoundError({
      type: "video",
      params: { id: "vid_1" },
    });

    const rebuilt = decodeRpcError(encodeRpcError(original));

    expect(rebuilt).toBeInstanceOf(NotFoundError);
    expect(rebuilt._tag).toBe("NotFoundError");
    expect((rebuilt as NotFoundError).type).toBe("video");
    expect((rebuilt as NotFoundError).params).toEqual({ id: "vid_1" });
  });

  it("preserves VersionNotDraftError's own message across the wire", () => {
    const original = new VersionNotDraftError({
      versionId: "ver_1",
      commitState: "published",
    });
    expect(original.message).toBe(VERSION_NOT_DRAFT_MESSAGE);

    const rebuilt = decodeRpcError(encodeRpcError(original));

    expect(rebuilt).toBeInstanceOf(VersionNotDraftError);
    expect((rebuilt as VersionNotDraftError).message).toBe(
      VERSION_NOT_DRAFT_MESSAGE
    );
    expect((rebuilt as VersionNotDraftError).versionId).toBe("ver_1");
  });

  it("carries a declared message across the wire", () => {
    // `message` is a non-enumerable own property on anything extending Error,
    // so it only survives if it is asked for by name.
    const original = new CourseNameTakenError({
      name: "Alpha",
      slug: "alpha",
      message: "a course called Alpha already exists",
    });

    const payload = encodeRpcError(original);
    expect(payload.message).toBe("a course called Alpha already exists");
    expect((decodeRpcError(payload) as CourseNameTakenError).message).toBe(
      "a course called Alpha already exists"
    );
  });

  it("rebuilds a transport AuthenticationError", () => {
    const rebuilt = decodeRpcError(
      encodeRpcError(new AuthenticationError({ message: "nope" }))
    );

    expect(rebuilt).toBeInstanceOf(AuthenticationError);
    expect(rebuilt._tag).toBe("AuthenticationError");
  });

  it("never puts a raw cause on the wire", () => {
    // UnknownDBServiceError wraps whatever the driver threw — a Postgres error
    // carrying the failing SQL, sometimes with values in it. That is exactly
    // what must not leave the deployed app.
    const payload = encodeRpcError(
      new UnknownDBServiceError({
        cause: new Error("select * from secrets where token = 'hunter2'"),
      })
    );

    expect(payload._tag).toBe("UnknownDBServiceError");
    expect(JSON.stringify(payload)).not.toContain("hunter2");
  });

  it("keeps the tag of an error it has never heard of", () => {
    const rebuilt = decodeRpcError({
      _tag: "SomethingInventedLater",
      detail: "whatever",
    });

    expect(rebuilt._tag).toBe("SomethingInventedLater");
    expect((rebuilt as unknown as { detail: string }).detail).toBe("whatever");
  });

  it("encodes a non-tagged throwable as an UnknownDBServiceError", () => {
    expect(encodeRpcError(new Error("boom"))._tag).toBe(
      "UnknownDBServiceError"
    );
    expect(encodeRpcError("boom")._tag).toBe("UnknownDBServiceError");
  });
});

describe("isRpcFailure", () => {
  it("discriminates the envelope", () => {
    expect(isRpcFailure({ ok: true, value: 1 })).toBe(false);
    expect(isRpcFailure({ ok: false, error: { _tag: "NotFoundError" } })).toBe(
      true
    );
    expect(isRpcFailure(null)).toBe(false);
    expect(isRpcFailure("nope")).toBe(false);
  });
});
