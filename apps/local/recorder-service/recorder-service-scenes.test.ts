import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clock,
  connect,
  readLog,
  start,
  T0_MS,
  tmp,
} from "./test-utils/service-harness";

/** Scenes switched live, through the recorder service's WebSocket. */

describe("scenes", () => {
  it("switches scenes live: the preview's scene while open, a logged scene event in picture file time while recording", async () => {
    const s = await start();
    const client = await connect(s.port);
    client.send({ type: "switch-scene", scene: "Camera" });
    expect((await client.next("refused")).command).toBe("switch-scene");

    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    client.send({ type: "switch-scene", scene: "No Face" });
    await client.next(
      "state",
      (m) => m.state.kind === "open" && m.state.scene === "No Face"
    );

    client.send({ type: "record", silenceLength: "long", folder: tmp() });
    const started = await client.next("recording-started");
    // A Recording Session starts in the scene the preview was in.
    expect(await client.next("scene-changed")).toMatchObject({
      scene: "No Face",
      fileTime: 0,
      seq: started.seq + 1,
    });

    clock.ms = T0_MS + 4_250;
    client.send({ type: "switch-scene", scene: "Camera" });
    const changed = await client.next("scene-changed");
    expect(changed).toMatchObject({
      scene: "Camera",
      fileTime: 4.25,
      recordingSessionId: started.recordingSessionId,
    });
    await client.next(
      "state",
      (m) => m.state.kind === "recording" && m.state.scene === "Camera"
    );

    client.send({ type: "stop" });
    await client.next("recording-stopped");
    const logged = readLog(
      path.join(path.dirname(started.files.mic), "events.jsonl")
    );
    expect(logged.filter((e) => e.type === "scene-changed")).toEqual([
      expect.objectContaining({ scene: "No Face", fileTime: 0 }),
      expect.objectContaining({
        scene: "Camera",
        fileTime: 4.25,
        seq: changed.seq,
      }),
    ]);
    // The next Recording Session starts where this one ended.
    expect((await client.camera("live")).state).toMatchObject({
      scene: "Camera",
    });
  });
});
