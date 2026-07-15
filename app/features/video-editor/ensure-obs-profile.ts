import type { OBSWebSocket } from "obs-websocket-js";
import type { VideoFormat } from "@/features/videos/video-format";

export const OBS_PROFILE_LANDSCAPE = "Landscape Recording";
export const OBS_PROFILE_TIKTOK = "TikTok";

export function targetProfileForFormat(format: VideoFormat): string {
  return format === "short" ? OBS_PROFILE_TIKTOK : OBS_PROFILE_LANDSCAPE;
}

export type EnsureProfileResult =
  | { type: "already-active" }
  | { type: "switched" }
  | { type: "error"; message: string };

export async function ensureOBSProfile(
  websocket: OBSWebSocket,
  targetProfile: string
): Promise<EnsureProfileResult> {
  const profileList = await websocket.call("GetProfileList");

  if (profileList.currentProfileName === targetProfile) {
    return { type: "already-active" };
  }

  if (!profileList.profiles.includes(targetProfile)) {
    return {
      type: "error",
      message: `OBS profile "${targetProfile}" not found. Available profiles: ${profileList.profiles.join(", ")}. Create the profile in OBS manually.`,
    };
  }

  await websocket.call("StopVirtualCam");
  await websocket.call("SetCurrentProfile", { profileName: targetProfile });
  await websocket.call("StartVirtualCam");

  return { type: "switched" };
}
