/**
 * The `render-vertical` Job (`sidecar/kinds/render-vertical.ts`), as
 * `cvm short render` knows it: it enqueues the Job and reads the finished
 * file's path off its `rendered` Job Event.
 */
export const RENDER_VERTICAL_JOB_KIND = "render-vertical";

export const RENDER_VERTICAL_EVENTS = {
  /** The vertical file is written: `{ path }`, absolute, in finished-videos/. */
  rendered: "rendered",
} as const;
