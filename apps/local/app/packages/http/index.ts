/**
 * The http package: the one owner of `fetch` in plain TypeScript in
 * apps/local. `httpRequest` takes what `fetch` takes and answers with its
 * `Response`. Effect code uses `@effect/platform`'s `HttpClient` instead.
 */
export { httpRequest } from "./lib/http-request";
