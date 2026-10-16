import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { readTldrawLicenseKey } from "./tldraw-license-key.server";

const readWith = (env: Record<string, string>) =>
  Effect.runSync(
    readTldrawLicenseKey.pipe(
      Effect.withConfigProvider(
        ConfigProvider.fromMap(new Map(Object.entries(env)))
      )
    )
  );

describe("readTldrawLicenseKey", () => {
  it("returns the key when it is set", () => {
    expect(readWith({ TLDRAW_LICENSE_KEY: "tldraw-abc" })).toBe("tldraw-abc");
  });

  it("is undefined when the variable is unset", () => {
    expect(readWith({})).toBeUndefined();
  });

  it("is undefined when the variable is empty", () => {
    expect(readWith({ TLDRAW_LICENSE_KEY: "" })).toBeUndefined();
  });
});
