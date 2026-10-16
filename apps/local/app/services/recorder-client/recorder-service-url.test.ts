import { describe, expect, it } from "vitest";
import { DEAD_DESK_URL } from "live-desk/live-desk";
import {
  REAL_RECORDER_SERVICE_URL,
  recorderServiceUrl,
} from "./recorder-service-url";

/**
 * Only Matt's own app server reaches his recorder service. An agent's
 * verify-cvm run in a full `git clone` passed `isMainCheckout`, connected to
 * the real service, and fought his app server for the recorder mid-filming:
 * his editor flashed between "Opening the recorder…" and "Ready to record."
 */
const url = (env: Record<string, string | undefined>, mainCheckout = true) =>
  recorderServiceUrl({ env, mainCheckout: () => mainCheckout });

describe("recorderServiceUrl", () => {
  it("gives Matt's main checkout the real recorder service", () => {
    expect(url({})).toBe(REAL_RECORDER_SERVICE_URL);
  });

  it("gives any other checkout the dead address", () => {
    expect(url({}, false)).toBe(DEAD_DESK_URL);
  });

  it("never gives an agent's verify-cvm run the real service, even in a full clone", () => {
    expect(url({ CVM_VERIFY_RUN_DIR: "/tmp/run-1" })).toBe(DEAD_DESK_URL);
  });

  it("never gives a server on a verify-cvm database the real service", () => {
    expect(
      url({ DATABASE_URL: "postgres://u@localhost:5432/cvm_verify_run_1" })
    ).toBe(DEAD_DESK_URL);
  });

  it("never gives a CVM_NO_REAL_DRIVES process the real service", () => {
    expect(url({ CVM_NO_REAL_DRIVES: "1" })).toBe(DEAD_DESK_URL);
  });

  it("refuses an agent an explicit RECORDER_SERVICE_URL at the real port", () => {
    expect(
      url({
        CVM_VERIFY_RUN_DIR: "/tmp/run-1",
        RECORDER_SERVICE_URL: "ws://localhost:5177",
      })
    ).toBe(DEAD_DESK_URL);
  });

  it("lets an agent point at a fake recorder service on another port", () => {
    expect(
      url({
        CVM_NO_REAL_DRIVES: "1",
        RECORDER_SERVICE_URL: "ws://127.0.0.1:6177",
      })
    ).toBe("ws://127.0.0.1:6177");
  });

  it("lets Matt's server override the address", () => {
    expect(url({ RECORDER_SERVICE_URL: "ws://127.0.0.1:6177" }, false)).toBe(
      "ws://127.0.0.1:6177"
    );
  });
});
