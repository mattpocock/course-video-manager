import { describe, expect, it } from "vitest";
import { resolveProfileGateAction } from "./use-ensure-obs-profile";
import {
  OBS_PROFILE_LANDSCAPE,
  OBS_PROFILE_TIKTOK,
} from "./ensure-obs-profile";

describe("resolveProfileGateAction", () => {
  it("switches when the active profile is not the one we want", () => {
    expect(
      resolveProfileGateAction({
        obsStateType: "obs-connected",
        currentProfile: OBS_PROFILE_TIKTOK,
        targetProfile: OBS_PROFILE_LANDSCAPE,
        hasEnsured: false,
      })
    ).toEqual({ type: "switch-profile" });
  });

  it("is ready immediately when the active profile already matches", () => {
    expect(
      resolveProfileGateAction({
        obsStateType: "obs-connected",
        currentProfile: OBS_PROFILE_LANDSCAPE,
        targetProfile: OBS_PROFILE_LANDSCAPE,
        hasEnsured: false,
      })
    ).toEqual({ type: "ready" });
  });

  it("resets when OBS goes away, so the next connection ensures again", () => {
    expect(
      resolveProfileGateAction({
        obsStateType: "obs-not-running",
        currentProfile: null,
        targetProfile: OBS_PROFILE_LANDSCAPE,
        hasEnsured: true,
      })
    ).toEqual({ type: "reset" });
  });

  // Regression: hitting record moved OBS from "obs-connected" to
  // "obs-recording", which the old gate treated as a disconnect. That cleared
  // profileReady, which tore down the virtual camera — the live preview cut out
  // for the whole take, and speech detection got a null stream so no clips were
  // detected. Starting a recording must not disturb a settled gate.
  it("stays settled when a recording starts", () => {
    expect(
      resolveProfileGateAction({
        obsStateType: "obs-recording",
        currentProfile: OBS_PROFILE_LANDSCAPE,
        targetProfile: OBS_PROFILE_LANDSCAPE,
        hasEnsured: true,
      })
    ).toEqual({ type: "already-settled" });
  });

  it("stays settled when a recording starts on a mismatched profile", () => {
    expect(
      resolveProfileGateAction({
        obsStateType: "obs-recording",
        currentProfile: OBS_PROFILE_TIKTOK,
        targetProfile: OBS_PROFILE_LANDSCAPE,
        hasEnsured: true,
      })
    ).toEqual({ type: "already-settled" });
  });

  it("never switches profile mid-recording, even when the profile is wrong", () => {
    expect(
      resolveProfileGateAction({
        obsStateType: "obs-recording",
        currentProfile: OBS_PROFILE_TIKTOK,
        targetProfile: OBS_PROFILE_LANDSCAPE,
        hasEnsured: false,
      })
    ).toEqual({ type: "ready-without-settling" });
  });

  it("switches once a recording it arrived during has stopped", () => {
    // "ready-without-settling" leaves hasEnsured false, so the transition back
    // to obs-connected picks the profile switch back up.
    expect(
      resolveProfileGateAction({
        obsStateType: "obs-connected",
        currentProfile: OBS_PROFILE_TIKTOK,
        targetProfile: OBS_PROFILE_LANDSCAPE,
        hasEnsured: false,
      })
    ).toEqual({ type: "switch-profile" });
  });
});
