import { useRouteLoaderData } from "react-router";

/** What the root loader (root.tsx) returns. */
export type RootLoaderData = { tldrawLicenseKey: string | undefined };

/**
 * The tldraw licence key, for every `<Tldraw>` and `<TldrawImage>`'s
 * `licenseKey`. `undefined` when `TLDRAW_LICENSE_KEY` is unset, which leaves
 * tldraw's default watermark on.
 */
export const useTldrawLicenseKey = (): string | undefined =>
  (useRouteLoaderData("root") as RootLoaderData | undefined)?.tldrawLicenseKey;
