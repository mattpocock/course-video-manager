import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readServiceToken } from "./service-token-file";

const TOKEN = "pscale_tkn_id123:pscale_tkn_SECRETVALUE";

const tokenFile = (mode = 0o600, contents = `${TOKEN}\n`): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-token-"));
  const file = path.join(dir, "planetscale-backup-token");
  fs.writeFileSync(file, contents, { mode });
  fs.chmodSync(file, mode);
  return file;
};

describe("readServiceToken", () => {
  it("reads the one-line token from a chmod 600 file", () => {
    expect(readServiceToken(tokenFile())).toBe(TOKEN);
  });

  it("refuses a token file others can read", () => {
    expect(() => readServiceToken(tokenFile(0o644))).toThrow(
      "readable by group or others"
    );
  });

  it("refuses a missing token file", () => {
    expect(() =>
      readServiceToken(path.join(os.tmpdir(), "no-such-dir-cvm", "token"))
    ).toThrow("No PlanetScale service token");
  });

  it("refuses a malformed token without echoing it", () => {
    const error = (() => {
      try {
        readServiceToken(tokenFile(0o600, "SECRETVALUE only\n"));
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toContain("<SERVICE_TOKEN_ID>:<SERVICE_TOKEN>");
    expect(error?.message).not.toContain("SECRETVALUE");
  });
});
