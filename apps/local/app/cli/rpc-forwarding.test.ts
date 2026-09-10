import { forward } from "@cvm/remote/rpc";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { RemoteRuntime } from "@cvm/remote/runtime";

const makeRuntime = (service: unknown): RemoteRuntime =>
  ManagedRuntime.make(
    Layer.succeed(BeatOperationsService, service as never)
  ) as never;

describe("forward", () => {
  it("passes the selected call its typed argument tuple in order", async () => {
    const moveBeat = vi.fn(
      (beatId: string, targetVideoId: string, beforeBeatId: string | null) =>
        Effect.succeed({ beatId, targetVideoId, beforeBeatId })
    );
    const app = new Hono().post(
      "/moveBeat",
      forward(makeRuntime({ moveBeat }), BeatOperationsService, "moveBeat")
    );

    const response = await app.request("http://cvm-api.test/moveBeat", {
      method: "POST",
      body: JSON.stringify(["beat_1", "video_2", null]),
      headers: { "content-type": "application/json" },
    });

    expect(moveBeat).toHaveBeenCalledExactlyOnceWith("beat_1", "video_2", null);
    expect(await response.json()).toEqual({
      ok: true,
      value: { beatId: "beat_1", targetVideoId: "video_2", beforeBeatId: null },
    });
  });

  it("returns the existing transport failure for a non-array body", async () => {
    const app = new Hono().post(
      "/moveBeat",
      forward(
        makeRuntime({
          moveBeat: (
            beatId: string,
            targetVideoId: string,
            beforeBeatId: string | null
          ) => Effect.succeed({ beatId, targetVideoId, beforeBeatId }),
        }),
        BeatOperationsService,
        "moveBeat"
      )
    );

    const response = await app.request("http://cvm-api.test/moveBeat", {
      method: "POST",
      body: JSON.stringify({
        beatId: "beat_1",
        targetVideoId: "video_2",
        beforeBeatId: null,
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        _tag: "TransportError",
        message: "moveBeat expects a JSON array of arguments",
      },
    });
  });
});
