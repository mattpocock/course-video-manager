import { Config, Effect, Option } from "effect";

/**
 * The tldraw licence key, from `TLDRAW_LICENSE_KEY`. Optional: unset or empty
 * gives `undefined`, and tldraw falls back to its default watermark. A tldraw
 * licence key is meant to be shipped to the browser, so the root loader hands
 * it to every tldraw component (see use-tldraw-license-key.ts).
 */
export const readTldrawLicenseKey: Effect.Effect<string | undefined> =
  Config.option(Config.string("TLDRAW_LICENSE_KEY")).pipe(
    Effect.map((key) =>
      Option.getOrUndefined(
        Option.filter(key, (value) => value.trim().length > 0)
      )
    ),
    Effect.orElseSucceed(() => undefined)
  );
