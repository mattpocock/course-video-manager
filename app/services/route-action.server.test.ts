import { describe, it, expect, vi, beforeEach } from "vitest";
import { Cause, Data, Effect, Layer, ManagedRuntime, Runtime } from "effect";
import { makeAction } from "./route-action.server";
import { DatabaseDumpService } from "./dump-service";

function extractDieDefect(error: unknown): unknown {
  if (!Runtime.isFiberFailure(error)) throw error;
  const cause = (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")];
  const defects = [...Cause.defects(cause)];
  return defects[0];
}

let dumpCalled: boolean;

function makeMockDumpLayer() {
  dumpCalled = false;
  return Layer.succeed(DatabaseDumpService, {
    requestDump: Effect.sync(() => {
      dumpCalled = true;
    }),
  } as any);
}

function makeTestRuntime() {
  const layer = makeMockDumpLayer();
  return ManagedRuntime.make(layer);
}

function mockRequest(
  body?: unknown,
  contentType: "json" | "formData" = "json"
): Request {
  if (contentType === "formData" && body && typeof body === "object") {
    const formData = new FormData();
    for (const [key, value] of Object.entries(body as Record<string, string>)) {
      formData.append(key, value);
    }
    return new Request("http://test.local/action", {
      method: "POST",
      body: formData,
    });
  }

  return new Request("http://test.local/action", {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

class NotFoundError extends Data.TaggedError("NotFoundError")<{
  message: string;
}> {}

beforeEach(() => {
  dumpCalled = false;
});

describe("makeAction", () => {
  it("returns success value when effect succeeds", async () => {
    const runtime = makeTestRuntime();

    const action = makeAction(
      {
        effect: () => Effect.succeed({ id: "123" }),
      },
      runtime
    );

    const result = await action({
      request: mockRequest(),
      params: {},
    });

    expect(result).toEqual({ id: "123" });
  });

  it("passes params to the effect", async () => {
    const runtime = makeTestRuntime();

    const action = makeAction(
      {
        effect: ({ params }) => Effect.succeed({ courseId: params.courseId }),
      },
      runtime
    );

    const result = await action({
      request: mockRequest(),
      params: { courseId: "abc" },
    });

    expect(result).toEqual({ courseId: "abc" });
  });

  describe("input parsing", () => {
    it("parses JSON body when input is 'json'", async () => {
      const runtime = makeTestRuntime();
      let receivedPayload: unknown;

      const action = makeAction(
        {
          input: "json",
          effect: ({ payload }) => {
            receivedPayload = payload;
            return Effect.succeed({ ok: true });
          },
        },
        runtime
      );

      await action({
        request: mockRequest({ name: "test", value: 42 }),
        params: {},
      });

      expect(receivedPayload).toEqual({ name: "test", value: 42 });
    });

    it("parses formData when input is 'formData'", async () => {
      const runtime = makeTestRuntime();
      let receivedPayload: unknown;

      const action = makeAction(
        {
          input: "formData",
          effect: ({ payload }) => {
            receivedPayload = payload;
            return Effect.succeed({ ok: true });
          },
        },
        runtime
      );

      await action({
        request: mockRequest({ name: "test", value: "42" }, "formData"),
        params: {},
      });

      expect(receivedPayload).toEqual({ name: "test", value: "42" });
    });

    it("sets payload to undefined when input is 'none' (default)", async () => {
      const runtime = makeTestRuntime();
      let receivedPayload: unknown = "sentinel";

      const action = makeAction(
        {
          effect: ({ payload }) => {
            receivedPayload = payload;
            return Effect.succeed({ ok: true });
          },
        },
        runtime
      );

      await action({
        request: mockRequest(),
        params: {},
      });

      expect(receivedPayload).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("maps ParseError to 400 by default", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          effect: () => Effect.fail({ _tag: "ParseError" as const }),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error) as any;
        expect(defect.init.status).toBe(400);
        expect(defect.data).toBe("Invalid request");
      }
    });

    it("maps unknown errors to 500", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          effect: () => Effect.fail(new Error("something broke")),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error) as any;
        expect(defect.init.status).toBe(500);
        expect(defect.data).toBe("Internal server error");
      }
    });

    it("maps custom error tags to configured status codes", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          errors: { NotFoundError: 404 },
          effect: () => Effect.fail(new NotFoundError({ message: "missing" })),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error) as any;
        expect(defect.init.status).toBe(404);
        expect(defect.data).toBe("missing");
      }
    });

    it("custom errors extend rather than replace the default map", async () => {
      const runtime = makeTestRuntime();

      type E = { _tag: "ParseError" } | NotFoundError;
      const action = makeAction(
        {
          errors: { NotFoundError: 404 },
          effect: () => Effect.fail<E>({ _tag: "ParseError" }),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error) as any;
        expect(defect.init.status).toBe(400);
      }
    });

    it("uses error.message for custom-mapped errors when available", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          errors: { NotFoundError: 404 },
          effect: () =>
            Effect.fail(
              new NotFoundError({ message: "Course version not found" })
            ),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error) as any;
        expect(defect.init.status).toBe(404);
        expect(defect.data).toBe("Course version not found");
      }
    });

    it("falls back to generic message for custom-mapped errors without message", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          errors: { SomeError: 409 },
          effect: () => Effect.fail({ _tag: "SomeError" as const }),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error) as any;
        expect(defect.init.status).toBe(409);
        expect(defect.data).toBe("Conflict");
      }
    });

    it("uses generic message for default-mapped errors even with message", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          effect: () =>
            Effect.fail({ _tag: "ParseError" as const, message: "detailed" }),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error) as any;
        expect(defect.init.status).toBe(400);
        expect(defect.data).toBe("Invalid request");
      }
    });

    it("propagates Effect.die from inside the effect as-is", async () => {
      const runtime = makeTestRuntime();
      const sentinel = { custom: "defect" };

      const action = makeAction(
        {
          effect: () => Effect.die(sentinel),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error);
        expect(defect).toBe(sentinel);
      }
    });
  });

  describe("database dump", () => {
    it("triggers dump on success by default", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          effect: () => Effect.succeed({ ok: true }),
        },
        runtime
      );

      await action({ request: mockRequest(), params: {} });
      expect(dumpCalled).toBe(true);
    });

    it("does not trigger dump when dump is false", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          dump: false,
          effect: () => Effect.succeed({ ok: true }),
        },
        runtime
      );

      await action({ request: mockRequest(), params: {} });
      expect(dumpCalled).toBe(false);
    });
  });

  describe("logging", () => {
    it("logs error cause via Console.dir on error", async () => {
      const runtime = makeTestRuntime();
      const consoleDirSpy = vi
        .spyOn(console, "dir")
        .mockImplementation(() => {});

      const action = makeAction(
        {
          effect: () => Effect.fail(new Error("boom")),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
      } catch {
        // expected
      }

      expect(consoleDirSpy).toHaveBeenCalled();
      consoleDirSpy.mockRestore();
    });
  });
});
