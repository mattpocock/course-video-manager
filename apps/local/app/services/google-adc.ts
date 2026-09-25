import { Data, Effect } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

/**
 * APPLICATION DEFAULT CREDENTIALS — the bearer token Cloud Text-to-Speech
 * wants, and nothing else.
 *
 * WHY THIS EXISTS AT ALL. The Gemini API (`generativelanguage.googleapis.com`)
 * takes a one-line `x-goog-api-key` and caps TTS at 100 REQUESTS PER DAY on a
 * paid Tier 1 account. It counts requests, not tokens, and an Animatic is
 * hundreds of seven-second lines — the worst possible shape for that cap. The
 * SAME models and the SAME prebuilt voices are served by Cloud
 * Text-to-Speech, which has no daily cap at all. The entire price of moving is
 * that Cloud TTS speaks OAuth instead of an API key. This module is that
 * price.
 *
 * NO SDK, deliberately. `google-auth-library` would pull a dependency tree in
 * to do one `refresh_token` grant, and the repo's rule next door in
 * `clip-mockup-speech-gemini.ts` is plain `fetch` at every HTTP boundary.
 * Shelling out to `gcloud auth application-default print-access-token` was the
 * other candidate and was measured at 0.7s per CLI invocation against 0.09s
 * for the grant below; `cvm` is one process per invocation and an Animatic run
 * is hundreds of them, so that difference is minutes of wall clock.
 *
 * Only `authorized_user` is handled — what `gcloud auth application-default
 * login` writes. A service-account file is a different grant (a signed JWT)
 * and is NOT implemented; `GOOGLE_OAUTH_ACCESS_TOKEN` below is the escape
 * hatch for anyone who has a token by other means.
 */

/** Set this to hand the token in directly and skip ADC entirely. */
export const ACCESS_TOKEN_ENV_KEY = "GOOGLE_OAUTH_ACCESS_TOKEN";

/** Overrides the project billed for the call. */
export const PROJECT_ENV_KEY = "GOOGLE_CLOUD_PROJECT";

/** Google's OAuth token endpoint — the one URL this module talks to. */
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Refresh this many seconds BEFORE the token really expires. */
const EXPIRY_SKEW_SECONDS = 60;

/** No credential, or one this module cannot use. A human must act. */
export class GoogleCredentialsError extends Data.TaggedError(
  "GoogleCredentialsError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/** Where `gcloud` writes ADC, unless told otherwise. */
const adcPath = (): string =>
  process.env.GOOGLE_APPLICATION_CREDENTIALS ??
  join(homedir(), ".config", "gcloud", "application_default_credentials.json");

type AuthorizedUser = {
  type?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  quota_project_id?: string;
};

/**
 * The token and the project it is billed to. Both are needed on every call:
 * a user-credential token carries no project of its own, so Cloud TTS refuses
 * it without an `x-goog-user-project` header naming one.
 */
export interface GoogleAuth {
  readonly token: string;
  readonly project: string;
}

/**
 * In-process only. `cvm` is one process per invocation, so this saves the
 * second and later calls of a MULTI-CHUNK line, not calls across a run. A
 * token lasts an hour; caching it to disk would be a credential at rest for a
 * saving of 90ms, which is not a trade this repo makes.
 */
let cached: { auth: GoogleAuth; expiresAtMs: number } | undefined;

const readAdc = Effect.fn("readAdc")(function* () {
  const path = adcPath();
  const raw = yield* Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new GoogleCredentialsError({
        cause,
        message:
          `No Google credentials at ${path}. ` +
          `Run \`gcloud auth application-default login\` to create them, ` +
          `or set ${ACCESS_TOKEN_ENV_KEY} to a bearer token.`,
      }),
  });
  const parsed = yield* Effect.try({
    try: () => JSON.parse(raw) as AuthorizedUser,
    catch: (cause) =>
      new GoogleCredentialsError({
        cause,
        message: `${path} is not readable JSON.`,
      }),
  });
  if (
    parsed.type !== "authorized_user" ||
    !parsed.client_id ||
    !parsed.client_secret ||
    !parsed.refresh_token
  ) {
    return yield* new GoogleCredentialsError({
      cause: null,
      message:
        `${path} is not an \`authorized_user\` credential (found ` +
        `\`${parsed.type ?? "no type"}\`). Re-run ` +
        `\`gcloud auth application-default login\`, or set ` +
        `${ACCESS_TOKEN_ENV_KEY} to a bearer token.`,
    });
  }
  return parsed;
});

/** Trade the refresh token for an access token. One POST, plain fetch. */
const refresh = (creds: AuthorizedUser) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: creds.client_id ?? "",
          client_secret: creds.client_secret ?? "",
          refresh_token: creds.refresh_token ?? "",
          grant_type: "refresh_token",
        }),
      });
      const body = await res.text();
      if (!res.ok) {
        throw new Error(`Google refused the refresh (${res.status}): ${body}`);
      }
      return JSON.parse(body) as {
        access_token?: string;
        expires_in?: number;
      };
    },
    catch: (cause) =>
      new GoogleCredentialsError({
        cause,
        message:
          `Could not refresh the Google access token: ` +
          `${cause instanceof Error ? cause.message : String(cause)}. ` +
          `\`gcloud auth application-default login\` will mint a new one.`,
      }),
  });

/**
 * The bearer token and the billed project, from whatever is available.
 *
 * Order: an explicit `GOOGLE_OAUTH_ACCESS_TOKEN` wins outright (this is the
 * seam a test or a CI box uses, and it is why nothing in the suite reaches
 * Google); otherwise the ADC file is read and its refresh token spent.
 *
 * Read at CALL time, never at layer-build time — the same rule the speech
 * service documents, because `Effect.provide` builds a layer before the
 * effect inside it runs and the repo `.env` is not loaded until later.
 */
export const resolveGoogleAuth = Effect.fn("resolveGoogleAuth")(function* () {
  const override = process.env[ACCESS_TOKEN_ENV_KEY];
  if (override) {
    const project = process.env[PROJECT_ENV_KEY];
    if (!project) {
      return yield* new GoogleCredentialsError({
        cause: null,
        message: `${ACCESS_TOKEN_ENV_KEY} is set but ${PROJECT_ENV_KEY} is not — Cloud TTS needs a project to bill.`,
      });
    }
    return { token: override, project } satisfies GoogleAuth;
  }

  const now = Date.now();
  if (cached !== undefined && cached.expiresAtMs > now) return cached.auth;

  const creds = yield* readAdc();
  const project = process.env[PROJECT_ENV_KEY] ?? creds.quota_project_id;
  if (!project) {
    return yield* new GoogleCredentialsError({
      cause: null,
      message:
        `No Google Cloud project to bill. Set ${PROJECT_ENV_KEY}, or re-run ` +
        `\`gcloud auth application-default login\` so ADC records a quota project.`,
    });
  }

  const token = yield* refresh(creds);
  if (!token.access_token) {
    return yield* new GoogleCredentialsError({
      cause: null,
      message: "Google returned no access_token in the refresh response.",
    });
  }

  const auth: GoogleAuth = { token: token.access_token, project };
  cached = {
    auth,
    expiresAtMs:
      now +
      Math.max(0, (token.expires_in ?? 3600) - EXPIRY_SKEW_SECONDS) * 1000,
  };
  return auth;
});

/** Drop the in-process token. For tests, and for a credential swap mid-run. */
export const forgetGoogleAuth = (): void => {
  cached = undefined;
};
