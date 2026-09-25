import { Data, Effect } from "effect";
import { pathToFileURL } from "node:url";

/**
 * Turn an HTML page into a Clip Mockup frame.
 *
 * WHY HTML AND NOT A DESCRIPTION. The CLI will not accept a description of a
 * picture, only a picture, so an authoring agent has to really build every
 * frame. HTML is the surface it is best at: real code highlighting, real
 * fonts, real layout, one file it can rewrite after feedback. Remotion's
 * `renderStill` was considered and rejected — it would force the agent to
 * write React instead.
 *
 * WHY A SERVICE. A browser is the one thing in this feature that cannot run in
 * a test. Putting the capture behind an Effect service means every other part
 * of `cvm clip-mockup` — the "exactly one frame source" rule, the copy into
 * the frame store, the row write — is tested through the real CLI with this
 * one thing faked by `Layer.succeed`, and NO Chromium ever launches in the
 * suite.
 *
 * It lives in `apps/local` because it drives a browser and writes a file, and
 * `@cvm/core` is filesystem-free (dependency-cruiser enforced).
 *
 * THE BROWSER BINARY IS A SEPARATE DOWNLOAD. The `playwright` npm package is a
 * normal dependency, but Chromium itself is not: a human must run
 * `pnpm --filter @cvm/local exec playwright install chromium` ONCE on the
 * author's machine. Nothing in the test suite depends on it.
 */

/** Every Clip Mockup frame is exactly this size — a 1080p landscape frame. */
export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;

/** How long a single page gets to load and paint before the capture is failed. */
const CAPTURE_TIMEOUT_MS = 30_000;

/**
 * A page could not be turned into a frame.
 *
 * Its OWN tag, deliberately: the alternative is a blank 1920x1080 PNG, which
 * looks exactly like a successful capture of an empty page and would quietly
 * become a moment of the Animatic. A named failure is something an authoring
 * agent can read, fix in its HTML and retry; a blank frame is something it
 * only finds by watching.
 */
export class FrameCaptureError extends Data.TaggedError("FrameCaptureError")<{
  /** The HTML page that could not be captured. */
  readonly htmlPath: string;
  readonly cause: unknown;
  readonly message: string;
}> {}

export class FrameCaptureService extends Effect.Service<FrameCaptureService>()(
  "FrameCaptureService",
  {
    effect: Effect.gen(function* () {
      /**
       * Render `htmlPath` at 1920x1080 and write the PNG to `outputPath`.
       *
       * Writes to a path rather than returning bytes so a fake is trivially
       * "write these canned bytes there" and the caller's code path — read the
       * PNG, copy it into the frame store — is identical either way.
       */
      const captureHtmlToPng = Effect.fn("captureHtmlToPng")(
        function* (params: {
          readonly htmlPath: string;
          readonly outputPath: string;
        }) {
          const fail = (cause: unknown, message: string) =>
            new FrameCaptureError({
              htmlPath: params.htmlPath,
              cause,
              message,
            });

          // Imported at CALL time, not module load: `playwright` is heavy and
          // every `cvm` invocation loads this command module.
          const playwright = yield* Effect.tryPromise({
            try: () => import("playwright"),
            catch: (cause) =>
              fail(
                cause,
                "could not load Playwright. Install it with `pnpm --filter @cvm/local install`."
              ),
          });

          const browser = yield* Effect.tryPromise({
            try: () => playwright.chromium.launch(),
            catch: (cause) =>
              fail(
                cause,
                "could not launch Chromium. The browser binary is a separate download — run `pnpm --filter @cvm/local exec playwright install chromium` once on this machine."
              ),
          });

          return yield* Effect.tryPromise({
            try: async () => {
              const page = await browser.newPage({
                viewport: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
                deviceScaleFactor: 1,
              });
              const response = await page.goto(
                pathToFileURL(params.htmlPath).href,
                { waitUntil: "load", timeout: CAPTURE_TIMEOUT_MS }
              );
              if (response !== null && !response.ok()) {
                throw new Error(`the page responded ${response.status()}`);
              }
              // Web fonts settle after 'load'; a frame captured mid-swap shows
              // the fallback face, which is exactly the kind of wrong the author
              // would only notice while watching the Animatic.
              await page.evaluate(() =>
                document.fonts.ready.then(() => undefined)
              );
              // No `fullPage`: the frame is the VIEWPORT, so the output is
              // 1920x1080 whatever the page's own height turns out to be.
              await page.screenshot({ path: params.outputPath, type: "png" });
              return params.outputPath;
            },
            catch: (cause) =>
              fail(
                cause,
                // First line only: Playwright appends a multi-line, ANSI-coloured
                // call log that would drown the one sentence an agent needs.
                `could not capture ${params.htmlPath} as a frame: ${
                  cause instanceof Error
                    ? (cause.message.split("\n")[0] ?? cause.message)
                    : String(cause)
                }`
              ),
          }).pipe(
            Effect.ensuring(
              Effect.promise(() => browser.close().catch(() => undefined))
            )
          );
        }
      );

      return { captureHtmlToPng };
    }),
  }
) {}
