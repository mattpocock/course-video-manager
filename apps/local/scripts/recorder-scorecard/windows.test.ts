import { describe, expect, it } from "vitest";
import { AFFINITY_MASK } from "../windows-guard";
import { notIdle, type ProcessSample } from "./windows";

type Proc = ProcessSample["processes"][number];

const proc = (pid: number, o: Partial<Proc> = {}): Proc => ({
  pid,
  cpu100ns: 0,
  workingSet: 0,
  priority: "Idle",
  affinity: AFFINITY_MASK,
  tag: "cvm-recorder-preview-screen",
  ...o,
});

const sample = (...processes: Proc[]): ProcessSample => ({
  atMs: 0,
  processes,
});

/** What a process the run has just killed reads as, while it exits. */
const exiting = { priority: "", affinity: 0 };

const noResample = () => {
  throw new Error("read again when every process read properly");
};

describe("notIdle", () => {
  it("passes a run whose processes are all at Idle on cores 6-9", async () => {
    expect(await notIdle(sample(proc(1), proc(2)), noResample)).toEqual([]);
  });

  it("stops on a live process off Idle or off cores 6-9, without reading again", async () => {
    const normal = proc(1, { priority: "Normal" });
    const allCores = proc(2, { affinity: 0xfff });
    expect(
      await notIdle(sample(normal, allCores, proc(3)), noResample)
    ).toEqual([normal, allCores]);
  });

  it("ignores a process that read empty and is gone when read again (the preview-kill false alarm)", async () => {
    const off = await notIdle(sample(proc(47516, exiting), proc(2)), () =>
      Promise.resolve(sample(proc(2), proc(3)))
    );
    expect(off).toEqual([]);
  });

  it("ignores a process that read empty and reads Idle on cores 6-9 when read again", async () => {
    const off = await notIdle(sample(proc(1, exiting)), () =>
      Promise.resolve(sample(proc(1)))
    );
    expect(off).toEqual([]);
  });

  it("stops on a process that read empty and reads off Idle when read again", async () => {
    const high = proc(1, { priority: "High" });
    const off = await notIdle(sample(proc(1, exiting)), () =>
      Promise.resolve(sample(high))
    );
    expect(off).toEqual([high]);
  });

  it("stops on a live process that still reads empty when read again", async () => {
    const still = proc(1, exiting);
    const off = await notIdle(sample(still), () =>
      Promise.resolve(sample(still))
    );
    expect(off).toEqual([still]);
  });

  it("treats an affinity that did not parse as an empty read", async () => {
    const off = await notIdle(sample(proc(1, { affinity: NaN })), () =>
      Promise.resolve(sample())
    );
    expect(off).toEqual([]);
  });
});
