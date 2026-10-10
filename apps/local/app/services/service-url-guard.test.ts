import { describe, expect, it } from "vitest";
import {
  assertServiceUrlOverrides,
  judgeServiceUrlOverrides,
} from "./service-url-guard";

/** Every value here is made up: no real token or `.env` is read. */
describe("the service URL guard", () => {
  it("lets every override be unset, as it is day to day", () => {
    expect(judgeServiceUrlOverrides({})).toEqual([]);
  });

  it("lets each service be its official host", () => {
    expect(
      judgeServiceUrlOverrides({
        YOUTUBE_API_URL: "https://www.googleapis.com",
        GOOGLE_OAUTH_TOKEN_URL: "https://oauth2.googleapis.com/token",
        BUFFER_API_URL: "https://api.buffer.com/",
        S3_ENDPOINT: "https://s3.eu-west-2.amazonaws.com",
        AI_HERO_BASE_URL: "https://www.aihero.dev",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
        DROPBOX_API_URL: "https://api.dropboxapi.com",
        DROPBOX_CONTENT_URL: "https://content.dropboxapi.com",
      })
    ).toEqual([]);
  });

  it("lets each service be a loopback stub (verify-cvm, a test)", () => {
    expect(
      judgeServiceUrlOverrides({
        YOUTUBE_API_URL: "http://127.0.0.1:5391",
        BUFFER_API_URL: "http://localhost:4010",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:9/v1",
        S3_ENDPOINT: "http://[::1]:4010",
      })
    ).toEqual([]);
  });

  it("refuses any other host, naming the variable — production tokens would go there", () => {
    const refusals = judgeServiceUrlOverrides({
      BUFFER_API_URL: "https://buffer-proxy.example.com",
      AI_HERO_BASE_URL: "https://www.aihero.dev.evil.example",
      S3_ENDPOINT: "http://minio.lan:9000",
    });
    expect(refusals.map((r) => r.name)).toEqual([
      "BUFFER_API_URL",
      "S3_ENDPOINT",
      "AI_HERO_BASE_URL",
    ]);
    expect(refusals[0]?.message).toContain("buffer-proxy.example.com");
    expect(refusals[0]?.message).toContain("https://api.buffer.com");
  });

  it("refuses the official host over plain http, and a value that is not a URL", () => {
    expect(
      judgeServiceUrlOverrides({
        ANTHROPIC_BASE_URL: "http://api.anthropic.com",
        YOUTUBE_API_URL: "googleapis",
      }).map((r) => r.name)
    ).toEqual(["YOUTUBE_API_URL", "ANTHROPIC_BASE_URL"]);
  });

  it("fails startup loudly with every refusal at once", () => {
    expect(() =>
      assertServiceUrlOverrides({
        YOUTUBE_API_URL: "https://attacker.example",
        DROPBOX_CONTENT_URL: "https://attacker.example",
      })
    ).toThrow(/YOUTUBE_API_URL[\s\S]*DROPBOX_CONTENT_URL/);
  });
});
