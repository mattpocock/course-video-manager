import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import * as fs from "fs";
import { fromPartial } from "@total-typescript/shoehorn";
import { SidecarContextTest } from "@/services/sidecar-context";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { postToAiHero } from "./ai-hero-upload-service";

const TestLayer = Layer.merge(
  SidecarContextTest,
  Layer.succeed(
    LinkAuthOperationsService,
    fromPartial({
      getAiHeroAuth: () => Effect.succeed({ accessToken: "fake-token" }),
    })
  )
);

const BASE_URL = "https://aihero.test";
const TMP_FILE = "/tmp/ai-hero-upload-service-test.mp4";

let calls: { url: string; init: RequestInit }[] = [];

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });

beforeEach(() => {
  calls = [];
  vi.stubEnv("AI_HERO_BASE_URL", BASE_URL);
  fs.writeFileSync(TMP_FILE, Buffer.alloc(1024));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/api/uploads/multipart/create")) {
        return json({ uploadId: "up-1", key: "k-1", publicUrl: "" });
      }
      if (url.includes("/api/uploads/multipart/part-url")) {
        return json({ signedUrl: "https://s3.test/part", partNumber: 1 });
      }
      if (url === "https://s3.test/part") {
        return new Response(null, { status: 200, headers: { ETag: "e1" } });
      }
      if (url.endsWith("/api/uploads/multipart/complete")) {
        return json({ publicUrl: "https://s3.test/video.mp4", key: "k-1" });
      }
      if (url.endsWith("/api/posts") && init.method === "POST") {
        return json({ id: "post-1", slug: "server-slug" });
      }
      return json({});
    })
  );
});

afterEach(() => {
  fs.unlinkSync(TMP_FILE);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const saveCall = () => {
  const call = calls.find((c) => c.url.includes("action=save"));
  if (!call) throw new Error("No save call was made");
  return JSON.parse(call.init.body as string);
};

describe("postToAiHero", () => {
  it.each(["unlisted", "public"] as const)(
    "saves the post with the visibility it was given (%s)",
    async (visibility) => {
      await postToAiHero({
        filePath: TMP_FILE,
        title: "Learn Zod",
        body: "Body",
        description: "About Zod",
        slug: "learn-zod",
        visibility,
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(saveCall().fields).toMatchObject({
        title: "Learn Zod",
        slug: "learn-zod",
        visibility,
      });
      // Publishing keeps the saved fields: it must not send its own.
      const publish = calls.find((c) => c.url.includes("action=publish"));
      expect(JSON.parse(publish!.init.body as string)).toEqual({});
    }
  );
});
