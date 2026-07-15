import { describe, it, expect } from "vitest";
import { isCapturableUrl, getWebLinkLabel } from "./clip-web-link";

describe("isCapturableUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isCapturableUrl("http://example.com")).toBe(true);
    expect(isCapturableUrl("https://example.com/page?x=1")).toBe(true);
    expect(isCapturableUrl("https://localhost:5173/foo")).toBe(true);
  });

  it("rejects file, chrome, edge, about and extension URLs", () => {
    expect(isCapturableUrl("file:///Users/matt/notes.txt")).toBe(false);
    expect(isCapturableUrl("chrome://newtab/")).toBe(false);
    expect(isCapturableUrl("edge://settings")).toBe(false);
    expect(isCapturableUrl("about:blank")).toBe(false);
    expect(isCapturableUrl("chrome-extension://abc/page.html")).toBe(false);
  });

  it("rejects empty and malformed URLs", () => {
    expect(isCapturableUrl("")).toBe(false);
    expect(isCapturableUrl("not a url")).toBe(false);
  });
});

describe("getWebLinkLabel", () => {
  it("returns host without scheme, dropping a bare trailing slash", () => {
    expect(getWebLinkLabel("https://example.com/")).toBe("example.com");
    expect(getWebLinkLabel("https://example.com")).toBe("example.com");
  });

  it("returns only the domain, dropping path and query", () => {
    expect(getWebLinkLabel("https://example.com/docs/api?x=1")).toBe(
      "example.com"
    );
  });

  it("includes port when present", () => {
    expect(getWebLinkLabel("https://localhost:5173/foo")).toBe(
      "localhost:5173"
    );
  });

  it("falls back to the raw string for a malformed URL", () => {
    expect(getWebLinkLabel("not a url")).toBe("not a url");
  });
});
