import { describe, it, expect } from "vitest";
import {
  replaceChooseScreenshotWithImage,
  updateChooseScreenshotClipIndex,
  removeChooseScreenshot,
  hasUnresolvedScreenshots,
} from "./choose-screenshot-mutations";

describe("replaceChooseScreenshotWithImage", () => {
  it("replaces a ChooseScreenshot tag with markdown image", () => {
    const message = `Some text before

<ChooseScreenshot clipIndex={3} alt="VS Code showing error" />

Some text after`;

    const result = replaceChooseScreenshotWithImage(
      message,
      3,
      "VS Code showing error",
      "./screenshot-1.png"
    );

    expect(result).toBe(`Some text before

![VS Code showing error](./screenshot-1.png)

Some text after`);
  });

  it("replaces only the matching tag when multiple exist", () => {
    const message = `<ChooseScreenshot clipIndex={1} alt="first" />

Some middle text

<ChooseScreenshot clipIndex={3} alt="second" />`;

    const result = replaceChooseScreenshotWithImage(
      message,
      3,
      "second",
      "./screenshot-2.png"
    );

    expect(result).toBe(`<ChooseScreenshot clipIndex={1} alt="first" />

Some middle text

![second](./screenshot-2.png)`);
  });

  it("handles alt text with special regex characters", () => {
    const message = `<ChooseScreenshot clipIndex={1} alt="array.map() call" />`;

    const result = replaceChooseScreenshotWithImage(
      message,
      1,
      "array.map() call",
      "./screenshot-1.png"
    );

    expect(result).toBe(`![array.map() call](./screenshot-1.png)`);
  });
});

describe("updateChooseScreenshotClipIndex", () => {
  it("updates clipIndex in a tag", () => {
    const message = `<ChooseScreenshot clipIndex={3} alt="test" />`;

    const result = updateChooseScreenshotClipIndex(message, 3, 4, "test");

    expect(result).toBe(`<ChooseScreenshot clipIndex={4} alt="test" />`);
  });

  it("updates only the matching tag when multiple exist", () => {
    const message = `<ChooseScreenshot clipIndex={1} alt="first" />

<ChooseScreenshot clipIndex={3} alt="second" />`;

    const result = updateChooseScreenshotClipIndex(message, 1, 2, "first");

    expect(result).toBe(`<ChooseScreenshot clipIndex={2} alt="first" />

<ChooseScreenshot clipIndex={3} alt="second" />`);
  });

  it("handles decrementing clipIndex", () => {
    const message = `<ChooseScreenshot clipIndex={5} alt="terminal output" />`;

    const result = updateChooseScreenshotClipIndex(
      message,
      5,
      4,
      "terminal output"
    );

    expect(result).toBe(
      `<ChooseScreenshot clipIndex={4} alt="terminal output" />`
    );
  });
});

describe("removeChooseScreenshot", () => {
  it("removes the tag and two trailing newlines", () => {
    const message = `Some text before

<ChooseScreenshot clipIndex={3} alt="VS Code showing error" />

Some text after`;

    const result = removeChooseScreenshot(message, 3, "VS Code showing error");

    expect(result).toBe(`Some text before

Some text after`);
  });

  it("removes only the matching tag when multiple exist", () => {
    const message = `<ChooseScreenshot clipIndex={1} alt="first" />

Some middle text

<ChooseScreenshot clipIndex={3} alt="second" />

End text`;

    const result = removeChooseScreenshot(message, 1, "first");

    expect(result).toBe(`Some middle text

<ChooseScreenshot clipIndex={3} alt="second" />

End text`);
  });

  it("removes tag with fewer than two trailing newlines", () => {
    const message = `<ChooseScreenshot clipIndex={1} alt="test" />
Next line`;

    const result = removeChooseScreenshot(message, 1, "test");

    expect(result).toBe(`Next line`);
  });

  it("removes tag at end of string with no trailing newlines", () => {
    const message = `Some text

<ChooseScreenshot clipIndex={2} alt="end" />`;

    const result = removeChooseScreenshot(message, 2, "end");

    expect(result).toBe(`Some text

`);
  });
});

describe("hasUnresolvedScreenshots", () => {
  it("returns true when message contains ChooseScreenshot tags", () => {
    const message = `Some text

<ChooseScreenshot clipIndex={1} alt="test" />

More text`;

    expect(hasUnresolvedScreenshots(message)).toBe(true);
  });

  it("returns false when no ChooseScreenshot tags exist", () => {
    const message = `Some text with ![image](./path.png) but no screenshot tags`;

    expect(hasUnresolvedScreenshots(message)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasUnresolvedScreenshots("")).toBe(false);
  });

  it("returns true with multiple tags", () => {
    const message = `<ChooseScreenshot clipIndex={1} alt="a" />
<ChooseScreenshot clipIndex={2} alt="b" />`;

    expect(hasUnresolvedScreenshots(message)).toBe(true);
  });

  it("returns false when all tags have been replaced", () => {
    const message = `![a](./screenshot-1.png)

![b](./screenshot-2.png)`;

    expect(hasUnresolvedScreenshots(message)).toBe(false);
  });

  it("detects unresolved tags in a full document with resolved images", () => {
    const document = `# Article Title

Here is the first screenshot:

![resolved](./screenshot-1.png)

And here is one still pending:

<ChooseScreenshot clipIndex={5} alt="pending screenshot" />

## Conclusion

Done.`;

    expect(hasUnresolvedScreenshots(document)).toBe(true);
  });

  it("returns false for a full document where all screenshots are resolved", () => {
    const document = `# Article Title

Here is the first screenshot:

![resolved](./screenshot-1.png)

And the second:

![also resolved](./screenshot-2.png)

## Conclusion

Done.`;

    expect(hasUnresolvedScreenshots(document)).toBe(false);
  });
});
