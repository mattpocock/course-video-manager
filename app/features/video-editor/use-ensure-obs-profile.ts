import { useEffect, useRef } from "react";
import type { OBSConnectionOuterState } from "./obs-connector";
import type { EnsureProfileResult } from "./ensure-obs-profile";

export function useEnsureOBSProfile(opts: {
  obsState: OBSConnectionOuterState;
  targetProfile: string;
  ensureProfile: (targetProfile: string) => Promise<EnsureProfileResult>;
  onError: (message: string) => void;
}) {
  const hasEnsuredRef = useRef(false);

  useEffect(() => {
    if (opts.obsState.type !== "obs-connected") {
      hasEnsuredRef.current = false;
      return;
    }

    if (hasEnsuredRef.current) return;
    if (opts.obsState.profile === opts.targetProfile) {
      hasEnsuredRef.current = true;
      return;
    }

    hasEnsuredRef.current = true;
    opts.ensureProfile(opts.targetProfile).then((result) => {
      if (result.type === "error") {
        opts.onError(result.message);
      }
    });
  }, [opts.obsState.type, opts.targetProfile]);
}
