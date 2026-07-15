import { describe, expect, it, vi } from "vitest";
import {
  ensureOBSProfile,
  targetProfileForFormat,
  OBS_PROFILE_LANDSCAPE,
  OBS_PROFILE_TIKTOK,
} from "./ensure-obs-profile";

function createMockWebSocket(opts: {
  currentProfileName: string;
  profiles: string[];
}) {
  const calls: Array<{ method: string; args?: unknown }> = [];

  return {
    calls,
    websocket: {
      call: vi.fn(async (method: string, args?: unknown) => {
        calls.push({ method, args });
        if (method === "GetProfileList") {
          return {
            currentProfileName: opts.currentProfileName,
            profiles: opts.profiles,
          };
        }
        return undefined;
      }),
    },
  };
}

describe("ensureOBSProfile", () => {
  it("no-ops when already on the target profile", async () => {
    const { websocket, calls } = createMockWebSocket({
      currentProfileName: "TikTok",
      profiles: ["Landscape Recording", "TikTok"],
    });

    const result = await ensureOBSProfile(websocket as any, "TikTok");

    expect(result).toEqual({ type: "already-active" });
    expect(calls).toEqual([{ method: "GetProfileList", args: undefined }]);
  });

  it("switches profile with StopVirtualCam → SetCurrentProfile → StartVirtualCam", async () => {
    const { websocket, calls } = createMockWebSocket({
      currentProfileName: "Landscape Recording",
      profiles: ["Landscape Recording", "TikTok"],
    });

    const result = await ensureOBSProfile(websocket as any, "TikTok");

    expect(result).toEqual({ type: "switched" });
    expect(calls.map((c) => c.method)).toEqual([
      "GetProfileList",
      "StopVirtualCam",
      "SetCurrentProfile",
      "StartVirtualCam",
    ]);
    expect(calls[2]!.args).toEqual({ profileName: "TikTok" });
  });

  it("returns error when target profile does not exist", async () => {
    const { websocket, calls } = createMockWebSocket({
      currentProfileName: "Landscape Recording",
      profiles: ["Landscape Recording"],
    });

    const result = await ensureOBSProfile(websocket as any, "TikTok");

    expect(result.type).toBe("error");
    expect((result as any).message).toContain("TikTok");
    expect((result as any).message).toContain("not found");
    // Must not call SetCurrentProfile or CreateProfile
    expect(calls.map((c) => c.method)).toEqual(["GetProfileList"]);
  });

  it("does not call CreateProfile for missing profiles", async () => {
    const { websocket, calls } = createMockWebSocket({
      currentProfileName: "Default",
      profiles: ["Default"],
    });

    await ensureOBSProfile(websocket as any, "TikTok");

    expect(calls.every((c) => c.method !== "CreateProfile")).toBe(true);
  });

  it("switches from TikTok to Landscape Recording", async () => {
    const { websocket, calls } = createMockWebSocket({
      currentProfileName: "TikTok",
      profiles: ["Landscape Recording", "TikTok"],
    });

    const result = await ensureOBSProfile(
      websocket as any,
      "Landscape Recording"
    );

    expect(result).toEqual({ type: "switched" });
    expect(calls[2]!.args).toEqual({ profileName: "Landscape Recording" });
  });

  it("lists available profiles in the error message", async () => {
    const { websocket } = createMockWebSocket({
      currentProfileName: "Default",
      profiles: ["Default", "Landscape Recording"],
    });

    const result = await ensureOBSProfile(websocket as any, "TikTok");

    expect(result.type).toBe("error");
    expect((result as any).message).toContain("Default");
    expect((result as any).message).toContain("Landscape Recording");
  });
});

describe("targetProfileForFormat", () => {
  it("returns Landscape Recording for standard format", () => {
    expect(targetProfileForFormat("standard")).toBe(OBS_PROFILE_LANDSCAPE);
  });

  it("returns TikTok for short format", () => {
    expect(targetProfileForFormat("short")).toBe(OBS_PROFILE_TIKTOK);
  });
});
