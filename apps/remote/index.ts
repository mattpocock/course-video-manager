import { app } from "./app.js";

/**
 * The Vercel entry point.
 *
 * Vercel has a first-class Hono framework preset: it wants the app
 * DEFAULT-EXPORTED from the entry file and does the rest itself. So there is no
 * `hono/vercel` adapter here, no `api/` directory and no Vercel adapter package
 * in `package.json` — adding any of them would fight the preset rather than
 * help it.
 */
export default app;
