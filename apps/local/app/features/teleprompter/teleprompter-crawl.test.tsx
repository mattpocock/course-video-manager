import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseScriptBlocks } from "./script-blocks";
import { TeleprompterCrawl } from "./teleprompter-crawl";

/**
 * The crawl's own animation is a rAF loop in an effect, so static markup is the
 * whole surface here: what the glass shows before anything moves.
 */
const render = (script: string) =>
  renderToStaticMarkup(
    <TeleprompterCrawl
      blocks={parseScriptBlocks(script)}
      wpm={200}
      playing={false}
      onTogglePlay={() => {}}
      onRewind={() => {}}
    />
  );

describe("TeleprompterCrawl", () => {
  // The likeliest place a URL appears in a Script: you don't read one aloud,
  // you open it mid-take.
  it("linkifies a URL inside a cue block", () => {
    const html = render("[open https://example.com and walk through it]");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
  });

  it("keeps a cue block's frame and words", () => {
    const html = render("[improvise the playthrough here]");
    expect(html).toContain("[ ");
    expect(html).toContain("improvise the playthrough here");
    expect(html).toContain(" ]");
  });

  // Nothing on a teleprompter may run off the right edge: a long URL or file
  // path has to break rather than take the line with it.
  it("breaks a word too long for the measure instead of overflowing", () => {
    expect(render("Go to https://example.com now.")).toMatch(
      /overflow-wrap:\s*anywhere/
    );
  });

  // A line of the script is as often something to copy out as something to
  // read aloud.
  it("lets the script be selected", () => {
    expect(render("Walk through the setup.")).toMatch(/user-select:\s*text/);
  });
});
