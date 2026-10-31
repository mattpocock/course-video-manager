import { describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { RecorderCommand } from "recorder-service/protocol";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import { clock, connect } from "recorder-service/test-utils/service-harness";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import {
  connectClient,
  recordOn,
  saveEvent,
  speak,
  startService,
  type Ingest,
} from "./recorder-client-test-harness";

/**
 * A take outlives the app server's connection to the recorder service: the
 * recorder keeps recording, and whatever the app server missed it catches up
 * on by replay, saving every Clip and scene event once.
 */

setupClipServiceTests();

/**
 * Stands between the recorder client and the service, so a test can cut the
 * connection (and keep it cut) without either end closing. Records the
 * commands the client sends.
 */
const startLink = async (servicePort: number) => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  const sent: RecorderCommand[] = [];
  let up = true;
  const pairs = new Set<[WebSocket, WebSocket]>();
  server.on("connection", (client) => {
    if (!up) return client.terminate();
    const service = new WebSocket(`ws://127.0.0.1:${servicePort}`);
    const pair: [WebSocket, WebSocket] = [client, service];
    pairs.add(pair);
    const queued: string[] = [];
    service.on("open", () => queued.splice(0).forEach((m) => service.send(m)));
    service.on("message", (data) => client.send(String(data)));
    client.on("message", (data) => {
      sent.push(JSON.parse(String(data)) as RecorderCommand);
      if (service.readyState === WebSocket.OPEN) service.send(String(data));
      else queued.push(String(data));
    });
    const end = () => {
      pairs.delete(pair);
      client.terminate();
      service.terminate();
    };
    client.on("close", end);
    service.on("close", end);
  });
  const { port } = server.address() as { port: number };
  return {
    port,
    sent,
    cut: () => {
      up = false;
      for (const [client] of pairs) client.terminate();
    },
    restore: () => {
      up = true;
    },
    close: () => {
      for (const [client, service] of pairs) {
        client.terminate();
        service.terminate();
      }
      server.close();
    },
  };
};

const timeline = async (videoId: string) =>
  (await clipService.getTimeline(videoId)).flatMap((i) =>
    i.type === "clip"
      ? [[i.data.sourceStartTime, i.data.sourceEndTime, i.data.scene]]
      : []
  );

const sceneEvents = async () =>
  (
    await testDb.query.recordingSessionSceneEvents.findMany({
      orderBy: (e, { asc }) => asc(e.fileTime),
    })
  ).map((e) => [e.fileTime, e.scene]);

describe("the recorder client, cut off mid-take", () => {
  it("catches up on the speech and scenes it missed once it reconnects, saving each once, asking only for what it never heard", async () => {
    const { windows, port } = await startService();
    const link = await startLink(port);
    try {
      const client = connectClient(link.port);
      const deck = await connect(port);
      const video = await recordOn(client);
      const camera = windows.recorder("camera");
      camera.stderr("[silencedetect @ 1] silence_start: -0.0001\r\n");
      speak(camera, [2, 5]);
      await vi.waitFor(async () =>
        expect(await timeline(video.id)).toHaveLength(1)
      );
      await client.settled();
      const heard = (await deck.next("speech-ended")).seq;

      link.cut();
      clock.ms += 6_000;
      deck.send({ type: "switch-scene", scene: "Camera" });
      await deck.next("scene-changed", (m) => m.scene === "Camera");
      speak(camera, [7, 10]);
      await deck.next("speech-ended");
      link.restore();

      await vi.waitFor(async () =>
        expect(await timeline(video.id)).toHaveLength(2)
      );
      await client.settled();
      expect(await timeline(video.id)).toEqual([
        [2.15, 5.23, "Code"],
        [7.15, 10.23, "Camera"],
      ]);
      expect(await sceneEvents()).toEqual([
        [0, "Code"],
        [6, "Camera"],
      ]);
      // An editor opening now (a reload) hears the take and its scene.
      const late: CvmRecorderMessage[] = [];
      client.subscribe(video.id, (m) => late.push(m));
      expect(late).toEqual([
        expect.objectContaining({
          type: "recorder-status",
          recordingSessionId: (await testDb.query.recordingSessions.findFirst())
            ?.id,
        }),
        { type: "scene-changed", scene: "Camera" },
        { type: "stream-changed", stream: { kind: "idle" } },
      ]);

      const replays = link.sent.filter((c) => c.type === "replay");
      expect(replays.at(-1)).toMatchObject({
        afterSeq: expect.toSatisfy((seq: number) => seq >= heard),
      });
    } finally {
      link.close();
    }
  });

  it("replays the whole take after each app-server restart without saving anything twice", async () => {
    const { windows, port } = await startService();
    const first = connectClient(port);
    const deck = await connect(port);
    const video = await recordOn(first);
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 1] silence_start: -0.0001\r\n");
    speak(camera, [2, 5]);
    await vi.waitFor(async () =>
      expect(await timeline(video.id)).toHaveLength(1)
    );
    await first.settled();
    first.close();

    // While the app server is down: a scene change and a take.
    clock.ms += 6_000;
    deck.send({ type: "switch-scene", scene: "Camera" });
    await deck.next("scene-changed", (m) => m.scene === "Camera");
    speak(camera, [7, 10]);
    await deck.next("speech-ended");

    // Up again, twice over; each start replays the whole Recording Session.
    for (let restart = 0; restart < 2; restart++) {
      let speechEnds = 0;
      const counting: Ingest = (event, askEditor) => {
        if (event.type === "speech-ended") speechEnds++;
        return saveEvent(event, askEditor);
      };
      const client = connectClient(port, counting);
      await vi.waitFor(() => expect(speechEnds).toBe(2));
      await client.settled();
      client.close();
    }

    expect(await timeline(video.id)).toEqual([
      [2.15, 5.23, "Code"],
      [7.15, 10.23, "Camera"],
    ]);
    expect(await sceneEvents()).toEqual([
      [0, "Code"],
      [6, "Camera"],
    ]);
  });
});
