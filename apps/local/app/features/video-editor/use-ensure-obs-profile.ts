import { useEffect, useRef, useState } from "react";
import type { OBSConnectionOuterState } from "./obs-connector";
import type { EnsureProfileResult } from "./ensure-obs-profile";

export type ProfileGateAction =
  /** OBS is gone — hide the camera and allow ensuring again on reconnect. */
  | { type: "reset" }
  /** The profile has already been ensured for this connection. */
  | { type: "already-settled" }
  /**
   * Show the camera, but don't mark the profile as ensured. Used while OBS is
   * recording: switching profiles mid-recording would break the output file,
   * so the check is deferred until the recording stops.
   */
  | { type: "ready-without-settling" }
  /** The active profile is already the one we want. */
  | { type: "ready" }
  /** The active profile is wrong and it's safe to switch. */
  | { type: "switch-profile" };

export function resolveProfileGateAction(opts: {
  obsStateType: OBSConnectionOuterState["type"];
  currentProfile: string | null;
  targetProfile: string;
  hasEnsured: boolean;
}): ProfileGateAction {
  if (opts.obsStateType === "obs-not-running") {
    return { type: "reset" };
  }

  if (opts.hasEnsured) {
    return { type: "already-settled" };
  }

  if (opts.obsStateType === "obs-recording") {
    return { type: "ready-without-settling" };
  }

  if (opts.currentProfile === opts.targetProfile) {
    return { type: "ready" };
  }

  return { type: "switch-profile" };
}

export function useEnsureOBSProfile(opts: {
  obsState: OBSConnectionOuterState;
  targetProfile: string;
  ensureProfile: (targetProfile: string) => Promise<EnsureProfileResult>;
  onError: (message: string) => void;
}): { profileReady: boolean } {
  const [profileReady, setProfileReady] = useState(false);
  const hasEnsuredRef = useRef(false);

  useEffect(() => {
    const action = resolveProfileGateAction({
      obsStateType: opts.obsState.type,
      currentProfile:
        opts.obsState.type === "obs-not-running" ? null : opts.obsState.profile,
      targetProfile: opts.targetProfile,
      hasEnsured: hasEnsuredRef.current,
    });

    switch (action.type) {
      case "reset":
        hasEnsuredRef.current = false;
        setProfileReady(false);
        return;
      case "already-settled":
        return;
      case "ready-without-settling":
        setProfileReady(true);
        return;
      case "ready":
        hasEnsuredRef.current = true;
        setProfileReady(true);
        return;
      case "switch-profile":
        hasEnsuredRef.current = true;
        opts.ensureProfile(opts.targetProfile).then((result) => {
          if (result.type === "error") {
            opts.onError(result.message);
            return;
          }
          setProfileReady(true);
        });
        return;
    }
  }, [opts.obsState.type, opts.targetProfile]);

  return { profileReady };
}
