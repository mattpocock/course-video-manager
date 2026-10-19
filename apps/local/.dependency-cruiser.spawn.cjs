// @ts-check
// THE SPAWN GUARD (docs/plans/background-jobs-sidecar.md, section 3.7, guard 1).
//
// Background work — an encode, an Overlay render, a Publish — runs in the
// Sidecar, never in a request a browser tab keeps alive. Two rules hold that
// at the module graph; the runtime half is `SidecarContext`, which the work
// asks for and only the Sidecar's layer provides.
//
// 1. Nothing a route can reach may reach the Sidecar's spawners: the ffmpeg
//    encode runner and the encodes built on it, the Overlay renderer
//    (Remotion's `bin.mjs`), the vertical Short, Whisper transcription (its
//    ffmpeg audio extraction), and the Sidecar's own layer and Job handlers.
//    A route enqueues a Job instead.
//
// 2. Outside the Sidecar (`sidecar/`), `child_process` is imported only by
//    the entry points named below, each with why it stays: none is work the
//    author walks away from. ADR 0032 section 7 lists the same files, and
//    tests/background-jobs-guard.test.ts fails if one is missing there.
//    Anything else that needs to start a process is either one of
//    these, or a Job. The rule covers every module the graph reaches, not
//    just `app/`: the workspace packages (`packages/`, seen here as
//    `../../packages/…`) run inside the app server too.
//
// `@effect/platform`'s `Command` is the other way to start a process, and
// dependency-cruiser cannot see which export a module uses: that half is
// `scripts/check-background-jobs.ts` (the `spawn` guard), with the same
// entry points on its allowlist.

/** Only the Sidecar may reach these. */
const SIDECAR_SPAWNERS = [
  "^app/services/ffmpeg-run\\.ts$",
  "^app/services/ffmpeg-encode-commands\\.ts$",
  "^app/services/video-export-service\\.ts$",
  "^app/services/overlay-content-renderer\\.ts$",
  "^app/services/overlay-renderer-bin\\.ts$",
  "^app/services/render-vertical-video-service\\.ts$",
  "^app/services/whisper-transcription-service\\.ts$",
  "^app/services/footage-transcription\\.ts$",
  "^app/services/course-publish-service\\.ts$",
  "^sidecar/sidecar-layer\\.ts$",
  "^sidecar/job-kinds\\.ts$",
  "^sidecar/kinds/",
].join("|");

/**
 * The entry points to `child_process` outside the Sidecar. Most are something
 * the author clicks and waits on; the rest start no background work either
 * (ADR 0032 section 7).
 */
const INTERACTIVE_CHILD_PROCESS = [
  // "Send feedback": `gh issue create`, while the dialog waits.
  "^app/routes/api\\.feedback\\.ts$",
  // "Reveal in Explorer": `wslpath` and `explorer.exe` on one file.
  // "Open folder" / "Open in VS Code".
  "^app/services/open-folder-service\\.ts$",
  // Starts the Clip Mockup daemon (ADR 0031): a long-lived process of its
  // own that the CLI restarts on demand — not a Job, and not run by a request.
  "^app/services/clip-mockup-daemon/client\\.ts$",
  // The recorder service (ADR 0034, 0035, 0053): its own process that spawns
  // ffmpeg.exe, nvidia-smi.exe and PowerShell on Windows for a live Recording
  // Session — not a Job. Its launcher, its Windows clock, and the app
  // server's start of it while an editor is open (idling out after).
  "^recorder-service/windows-launcher\\.ts$",
  "^recorder-service/windows-clock\\.ts$",
  "^app/services/recorder-client/service-process\\.server\\.ts$",
  // Matt's live desk: one `git rev-parse` to tell the main checkout, so only
  // it starts the Stream Deck forwarder or the recorder service.
  "^live-desk/live-desk\\.ts$",
  // `GitWorktreeProbeLive` (packages/core): one synchronous `git rev-parse`,
  // memoized per process, when `DrizzleService` first connects, so a worktree
  // never writes to a remote database. Milliseconds, once — not a Job.
  "^\\.\\./\\.\\./packages/core/git-worktree\\.ts$",
  // The Storage page's scan: one read-only `fsutil dirty query` (then
  // `chkntfs <drive>`, display only) per drive, 5 s timeout, while the page
  // is open, to warn when a drive is Dirty.
  "^app/packages/storage/lib/dirty-bit\\.server\\.ts$",
].join("|");

/** The Sidecar starts its own processes: that is what it is for. */
const SIDECAR = "^sidecar/";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "spawn-runner-reachable-from-routes",
      comment:
        "A route reaches a Sidecar-only spawner (an encode, an Overlay render, a Publish, a Whisper transcription). Enqueue a Job instead: docs/plans/background-jobs-sidecar.md.",
      severity: "error",
      from: { path: "^app/routes/" },
      to: { path: SIDECAR_SPAWNERS, reachable: true },
    },
    {
      name: "child-process-outside-interactive-entry-points",
      comment:
        "Only the named interactive entry points in .dependency-cruiser.spawn.cjs start processes on the app server. Background work is a Job: docs/plans/background-jobs-sidecar.md.",
      severity: "error",
      from: { pathNot: `${INTERACTIVE_CHILD_PROCESS}|${SIDECAR}` },
      to: { path: "^(node:)?child_process$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.(test|spec)\\.tsx?$|/test-utils/" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
