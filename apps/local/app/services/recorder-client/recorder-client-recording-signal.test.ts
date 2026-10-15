import { describe, expect, it, vi } from "vitest";
import { clipService, setupClipServiceTests } from "../clip-service-test-setup";
import {
  startServiceAndClient as setup,
  tmp,
} from "./recorder-client-test-harness";

setupClipServiceTests();

describe("the recorder client's recording signal (the Still Gate's)", () => {
  it("says recording from Record to Stop, and tells each change once", async () => {
    const { client } = await setup();
    const video = await clipService.createVideo("CVM recorder");
    const heard: string[] = [];
    client.subscribe(video.id, (m) => heard.push(m.type));
    await vi.waitFor(() => expect(heard).toContain("camera-went-live"));
    const changes: boolean[] = [];
    client.onRecordingChange((recording) => changes.push(recording));
    expect(client.recording()).toBe(false);

    await client.startRecording(video.id, {
      silenceLength: "short",
      folder: tmp(),
    });
    expect(client.recording()).toBe(true);

    await client.stopRecording(video.id);
    expect(client.recording()).toBe(false);
    expect(changes).toEqual([true, false]);
  });
});
