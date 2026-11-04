import type { MetricDef } from "./metric-def";

/**
 * STILLS MID-TAKE (#2214, #2294): a placed Take's stills, asked for while
 * the take records (`stills.ts`).
 */
export const STILLS_METRICS: readonly MetricDef[] = [
  {
    id: "stills_decoded_mid_take",
    label:
      "Stills (a placed Take's last and first frame) decoded from the growing files mid-take",
    group: "reliability",
    unit: "stills",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
    note: "Each read the growing camera.mkv: two placed 6 s apart cost a streamed Recording Session 14 camera frames. Every still must be held until Stop. Details: `stillsMidTake.asked`.",
  },
  {
    id: "stills_take_camera_frames_lost",
    label: "Stills asked for mid-take: camera.mkv frames lost",
    group: "reliability",
    unit: "frames",
    better: "lower",
    target: 0,
    obs: null,
    scale: 1,
    note: "The service's framesLost plus the frames missing by index. Footage is on WSL's disk, not /mnt/d, so a decode that runs may lose none here.",
  },
];
