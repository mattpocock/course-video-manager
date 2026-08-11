import { describe, expect, it } from "vitest";
import {
  API_TOKEN_ID_PREFIX,
  generateApiToken,
  hashApiToken,
  parseApiToken,
  tokenHashesMatch,
} from "./api-token.server.js";

describe("generateApiToken", () => {
  it("issues a secret of the form cvm_<id>_<random>", () => {
    const minted = generateApiToken();

    expect(minted.id.startsWith(API_TOKEN_ID_PREFIX)).toBe(true);
    expect(minted.secret.startsWith(`${minted.id}_`)).toBe(true);

    const random = minted.secret.slice(minted.id.length + 1);
    // 32 random bytes, base64url — no padding, no + or /.
    expect(random).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(random.length).toBe(43);
  });

  it("stores the sha256 of the WHOLE secret, never the secret itself", () => {
    const minted = generateApiToken();

    expect(minted.tokenHash).toBe(hashApiToken(minted.secret));
    expect(minted.tokenHash).not.toContain(minted.secret);
    expect(minted.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never issues the same id or secret twice", () => {
    const a = generateApiToken();
    const b = generateApiToken();

    expect(a.id).not.toBe(b.id);
    expect(a.secret).not.toBe(b.secret);
  });
});

describe("parseApiToken", () => {
  it("recovers the public id from a minted secret", () => {
    const minted = generateApiToken();

    expect(parseApiToken(minted.secret)).toEqual({
      id: minted.id,
      tokenHash: minted.tokenHash,
    });
  });

  it.each([
    ["empty", ""],
    ["no prefix", "a1b2c3d4_deadbeef"],
    ["no random part", "cvm_a1b2c3d4"],
    ["empty random part", "cvm_a1b2c3d4_"],
    ["empty id", "cvm__deadbeef"],
    ["non-hex id", "cvm_zzzzzzzz_deadbeef"],
  ])("rejects a %s token", (_label, raw) => {
    expect(parseApiToken(raw)).toBeNull();
  });
});

describe("tokenHashesMatch", () => {
  it("is true for identical hashes and false otherwise", () => {
    const a = hashApiToken("cvm_a1b2c3d4_one");
    const b = hashApiToken("cvm_a1b2c3d4_two");

    expect(tokenHashesMatch(a, a)).toBe(true);
    expect(tokenHashesMatch(a, b)).toBe(false);
  });

  it("is false — not a throw — for a differently-sized candidate", () => {
    expect(tokenHashesMatch(hashApiToken("x"), "short")).toBe(false);
  });
});
