import { describe, it, expect, vi } from "vitest";
import { Data, Effect, Layer, ManagedRuntime, Runtime } from "effect";
import { createStaticHandler } from "react-router";
import { SystemError } from "@effect/platform/Error";
import { offlineRootMessage } from "@/packages/storage";
import { makeAction, makeLoader } from "./route-action.server";

// The app's layer refuses to load without STORAGE_ROOTS (its startup check);
// these tests read no file, so any root will do.
vi.hoisted(() => {
  process.env.STORAGE_ROOTS ??= "/test-storage-root";
});

/**
 * What a failed route throws: react-router's `data(message, init)`, unwrapped.
 * Naming the shape HERE is what keeps `as any` out of the assertions below.
 */
interface ThrownRouteData {
  data: string;
  init: { status: number };
}

/**
 * React Router reads a status only off a `data()` thrown as-is; wrapped in a
 * `FiberFailure` it answers 500, so a wrapped throw fails here.
 */
function extractDieDefect(error: unknown): ThrownRouteData {
  if (Runtime.isFiberFailure(error)) {
    throw new Error(
      "route threw a FiberFailure, which React Router answers 500",
      {
        cause: error,
      }
    );
  }
  return error as ThrownRouteData;
}

/**
 * makeAction/makeLoader provide nothing of their own, so the empty layer is
 * enough for every effect below — none of them ask for a service.
 */
function makeTestRuntime(): ManagedRuntime.ManagedRuntime<never, never> {
  return ManagedRuntime.make(Layer.empty);
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

/** A tagged error no route maps to a status. */
class SomethingBrokeError extends Data.TaggedError("SomethingBrokeError")<{
  message: string;
}> {}

describe("makeAction", () => {
  it("answers React Router with the mapped status, not 500", async () => {
    class JobNotRetryableError extends Data.TaggedError(
      "JobNotRetryableError"
    )<{ message: string }> {}

    const handler = createStaticHandler([
      {
        id: "retry",
        path: "/retry",
        action: makeAction(
          {
            errors: { JobNotRetryableError: 409 },
            effect: () =>
              Effect.fail(
                new JobNotRetryableError({
                  message: "went out: retrying would post it twice",
                })
              ),
          },
          makeTestRuntime()
        ),
      },
    ]);

    const context = await handler.query(
      new Request("http://test.local/retry", { method: "POST" })
    );

    if (context instanceof Response) throw new Error("expected a context");
    expect(context.statusCode).toBe(409);
    expect(context.errors?.retry).toMatchObject({
      status: 409,
      data: "went out: retrying would post it twice",
    });
  });

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
        const defect = extractDieDefect(error);
        expect(defect.init.status).toBe(400);
        expect(defect.data).toBe("Invalid request");
      }
    });

    it("answers 400 to a body that is not JSON", async () => {
      const action = makeAction(
        { input: "json", effect: () => Effect.succeed({ ok: true }) },
        makeTestRuntime()
      );

      try {
        await action({
          request: new Request("http://test.local/action", {
            method: "POST",
            body: "",
          }),
          params: {},
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error);
        expect(defect.init.status).toBe(400);
        expect(defect.data).toBe("Invalid request");
      }
    });

    it("maps an error tag with no configured status to 500", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          effect: () =>
            Effect.fail(
              new SomethingBrokeError({ message: "something broke" })
            ),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error);
        expect(defect.init.status).toBe(500);
        expect(defect.data).toBe("Internal server error");
      }
    });

    it("maps an untagged error to 500", async () => {
      const runtime = makeTestRuntime();

      const action = makeAction(
        {
          // Deliberately untagged: this pins the fallback for an error with
          // no `_tag` at all, which product code no longer produces.
          // @effect-diagnostics-next-line globalErrorInEffectFailure:off
          effect: () => Effect.fail(new Error("something broke")),
        },
        runtime
      );

      try {
        await action({ request: mockRequest(), params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error);
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
        const defect = extractDieDefect(error);
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
        const defect = extractDieDefect(error);
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
        const defect = extractDieDefect(error);
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
        const defect = extractDieDefect(error);
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
        const defect = extractDieDefect(error);
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

  describe("logging", () => {
    it("logs error cause via Console.dir on error", async () => {
      const runtime = makeTestRuntime();
      const consoleDirSpy = vi
        .spyOn(console, "dir")
        .mockImplementation(() => {});

      const action = makeAction(
        {
          effect: () =>
            Effect.fail(new SomethingBrokeError({ message: "boom" })),
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

const dummyRequest = new Request("http://localhost/test");

describe("makeLoader", () => {
  it("returns success value when effect succeeds", async () => {
    const runtime = makeTestRuntime();

    const loader = makeLoader(
      {
        effect: () => Effect.succeed({ items: [1, 2, 3] }),
      },
      runtime
    );

    const result = await loader({ request: dummyRequest, params: {} });

    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it("answers 503 naming the drive when a Storage Root is Offline, with no stack logged", async () => {
    const root = process.env.STORAGE_ROOTS!.split(",")[0]!;
    const path = `${root}/video-files/lineage-1`;
    const dir = vi.spyOn(console, "dir").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = makeLoader(
      {
        effect: () =>
          Effect.fail(
            new SystemError({
              reason: "Unknown",
              module: "FileSystem",
              method: "access",
              pathOrDescriptor: path,
              cause: Object.assign(new Error("ENODEV: no such device"), {
                code: "ENODEV",
              }),
            })
          ),
      },
      makeTestRuntime()
    );

    try {
      await loader({ request: dummyRequest, params: {} });
      expect.unreachable("should have thrown");
    } catch (error) {
      const defect = extractDieDefect(error);
      expect(defect.init.status).toBe(503);
      expect(defect.data).toBe(offlineRootMessage(root));
    } finally {
      expect(dir).not.toHaveBeenCalled();
      dir.mockRestore();
      warn.mockRestore();
    }
  });

  describe("error handling", () => {
    it("maps NotFoundError to 404 by default", async () => {
      const runtime = makeTestRuntime();

      const loader = makeLoader(
        {
          effect: () => Effect.fail(new NotFoundError({ message: "missing" })),
        },
        runtime
      );

      try {
        await loader({ request: dummyRequest, params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error);
        expect(defect.init.status).toBe(404);
        expect(defect.data).toBe("Not found");
      }
    });

    it("uses error.message when NotFoundError is explicitly configured", async () => {
      const runtime = makeTestRuntime();

      const loader = makeLoader(
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
        await loader({ request: dummyRequest, params: {} });
        expect.unreachable("should have thrown");
      } catch (error) {
        const defect = extractDieDefect(error);
        expect(defect.init.status).toBe(404);
        expect(defect.data).toBe("Course version not found");
      }
    });
  });
});
