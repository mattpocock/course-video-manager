import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpRequest } from "@/packages/http";
import { postAction } from "./post-action";

vi.mock("@/packages/http", () => ({ httpRequest: vi.fn() }));

const answer = (body: string, status: number) => {
  vi.mocked(httpRequest).mockResolvedValue(new Response(body, { status }));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("postAction", () => {
  it("POSTs the fields as form data and resolves with the action's JSON", async () => {
    answer(JSON.stringify({ success: true }), 200);

    await expect(postAction("/api/rename", { name: "New" })).resolves.toEqual({
      success: true,
    });

    const [url, init] = vi.mocked(httpRequest).mock.calls[0] ?? [];
    expect(url).toBe("/api/rename");
    expect(init?.method).toBe("POST");
    const body = init?.body;
    expect(body).toBeInstanceOf(FormData);
    expect(body instanceof FormData && body.get("name")).toBe("New");
  });

  it("resolves with null when a 2xx carries no JSON", async () => {
    answer("", 200);
    await expect(postAction("/api/x", {})).resolves.toBeNull();
  });

  it("rejects with the action's own message on a failure", async () => {
    answer(JSON.stringify("Course name taken"), 409);
    await expect(postAction("/api/x", {})).rejects.toThrow(
      new Error("Course name taken")
    );
  });

  it("rejects with an empty message when the failure body is not a message", async () => {
    answer("<html>Internal</html>", 500);
    await expect(postAction("/api/x", {})).rejects.toThrow(new Error(""));
  });
});
