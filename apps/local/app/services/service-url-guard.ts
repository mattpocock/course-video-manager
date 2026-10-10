/**
 * THE SERVICE URL GUARD. Every service the app talks to with a production
 * credential has a base-URL override, so a test or a verify-cvm run can point
 * it at a local stub. A stray value in the main checkout's `.env` would send
 * the real token — YouTube's OAuth token, Buffer's key, AWS's, AI Hero's,
 * Anthropic's, Dropbox's — to whatever host it names. So an
 * override may name only the service's own host (over https) or loopback
 * (a stub on this machine); anything else stops the process at startup,
 * naming the variable. Checked where each process starts: the app server
 * (`layer.server.ts`) and the sidecar (`run-sidecar.ts`).
 *
 * verify-cvm already narrows each of these to the discard port or a loopback
 * stub (`verify-clones.sh`), so its runs pass this as they are.
 */

interface ServiceUrlOverride {
  readonly name: string;
  /** The hosts the real service lives on; `*.` matches any subdomain. */
  readonly officialHosts: readonly string[];
  /** What it is when nothing overrides it, for the message. */
  readonly official: string;
}

export const SERVICE_URL_OVERRIDES: readonly ServiceUrlOverride[] = [
  {
    name: "YOUTUBE_API_URL",
    officialHosts: ["www.googleapis.com"],
    official: "https://www.googleapis.com",
  },
  {
    name: "GOOGLE_OAUTH_TOKEN_URL",
    officialHosts: ["oauth2.googleapis.com"],
    official: "https://oauth2.googleapis.com/token",
  },
  {
    name: "BUFFER_API_URL",
    officialHosts: ["api.buffer.com"],
    official: "https://api.buffer.com",
  },
  {
    name: "S3_ENDPOINT",
    officialHosts: ["*.amazonaws.com"],
    official: "https://s3.<region>.amazonaws.com, or unset for AWS",
  },
  {
    name: "AI_HERO_BASE_URL",
    officialHosts: ["www.aihero.dev", "aihero.dev"],
    official: "https://www.aihero.dev",
  },
  {
    name: "ANTHROPIC_BASE_URL",
    officialHosts: ["api.anthropic.com"],
    official: "https://api.anthropic.com/v1",
  },
  {
    name: "DROPBOX_API_URL",
    officialHosts: ["api.dropboxapi.com"],
    official: "https://api.dropboxapi.com",
  },
  {
    name: "DROPBOX_CONTENT_URL",
    officialHosts: ["content.dropboxapi.com"],
    official: "https://content.dropboxapi.com",
  },
];

export interface ServiceUrlRefusal {
  readonly name: string;
  readonly message: string;
}

const isLoopback = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  /^127(\.\d{1,3}){3}$/.test(hostname);

const isOfficial = (hostname: string, officialHosts: readonly string[]) =>
  officialHosts.some((host) =>
    host.startsWith("*.") ? hostname.endsWith(host.slice(1)) : hostname === host
  );

/** Why each override in `env` may not be used: empty when all may. */
export const judgeServiceUrlOverrides = (
  env: Readonly<Record<string, string | undefined>>
): ServiceUrlRefusal[] =>
  SERVICE_URL_OVERRIDES.flatMap((service) => {
    const value = env[service.name]?.trim();
    if (!value) return [];
    const refuse = (why: string): ServiceUrlRefusal[] => [
      {
        name: service.name,
        message: `${service.name}=${value} ${why}. It must be the service's own host over https (${service.official}) or a loopback stub (http://127.0.0.1:<port>); otherwise the real credential goes to that host.`,
      },
    ];
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return refuse("is not a URL");
    }
    if (isLoopback(url.hostname)) return [];
    if (!isOfficial(url.hostname, service.officialHosts)) {
      return refuse(`points at ${url.hostname}`);
    }
    if (url.protocol !== "https:") return refuse("is not https");
    return [];
  });

/** Stop the process now if any override may not be used. */
export const assertServiceUrlOverrides = (
  env: Readonly<Record<string, string | undefined>>
): void => {
  const refusals = judgeServiceUrlOverrides(env);
  if (refusals.length === 0) return;
  throw new Error(
    `Refusing to start: a service URL override would send production credentials to another host.\n${refusals
      .map((r) => `  - ${r.message}`)
      .join(
        "\n"
      )}\nRemove the line from .env, or point it at the service itself.`
  );
};
