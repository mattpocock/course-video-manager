import { Hono } from "hono";
import { authenticate } from "./auth";
import { beatRoutes } from "./routes/beat";
import { clipRoutes } from "./routes/clip";
import { courseRoutes } from "./routes/course";
import { deliverableRoutes } from "./routes/deliverable";
import { lessonRoutes } from "./routes/lesson";
import { pitchRoutes } from "./routes/pitch";
import { searchRoutes } from "./routes/search";
import { sectionRoutes } from "./routes/section";
import { versionRoutes } from "./routes/version";
import { videoRoutes } from "./routes/video";
import { remoteRuntime, type RemoteRuntime } from "./runtime";
import { requireSchemaVersion } from "./version";

/**
 * The deployed RPC API.
 *
 * ONE ENDPOINT PER CLI VERB, grouped by domain noun. There is deliberately no
 * resource modelling here: the API's job is to be the CLI's transport, so
 * adding a command is one endpoint and no design discussion.
 *
 * Each noun is a sub-app in `./routes`, MOUNTED rather than registered one
 * statement at a time, because mounting is what carries the routes' types out
 * through `RemoteApp` — the CLI's client is derived from that type, so a
 * client/server mismatch is a compile error rather than a 404 on a box nobody
 * is watching.
 *
 * `createApp` takes the runtime as an argument so the CLI test harness can hand
 * it a PGlite-backed one and call `app.fetch` with no server and no port.
 */
export const createApp = (runtime: RemoteRuntime) =>
  new Hono()
    // Unauthenticated on purpose: it answers nothing about the domain, and a
    // weekly ping is what stops Vercel archiving the function.
    .get("/health", (c) => c.json({ ok: true as const }))
    // Registered BEFORE the groups so they cover every one of them, including
    // any added later — which is what the wildcard is for.
    //
    // Authentication comes FIRST: a caller that cannot prove who it is learns
    // nothing at all, not even which schema this app is on.
    .use("/rpc/*", authenticate(runtime))
    .use("/rpc/*", requireSchemaVersion())
    .route("/rpc/search", searchRoutes(runtime))
    .route("/rpc/course", courseRoutes(runtime))
    .route("/rpc/version", versionRoutes(runtime))
    .route("/rpc/section", sectionRoutes(runtime))
    .route("/rpc/lesson", lessonRoutes(runtime))
    .route("/rpc/video", videoRoutes(runtime))
    .route("/rpc/clip", clipRoutes(runtime))
    .route("/rpc/beat", beatRoutes(runtime))
    .route("/rpc/pitch", pitchRoutes(runtime))
    .route("/rpc/deliverable", deliverableRoutes(runtime));

/**
 * The app type the CLI's client is built from. The CLI imports THIS AND ONLY
 * THIS from `@cvm/remote` — a `import type`, so no server code is ever bundled
 * into what runs on the remote box.
 */
export type RemoteApp = ReturnType<typeof createApp>;

/** The production app, on the production runtime. */
export const app = createApp(remoteRuntime);
