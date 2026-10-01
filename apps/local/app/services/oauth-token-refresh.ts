import { Config, ConfigProvider, Effect } from "effect";

/**
 * Refresh a stored OAuth access token 5 minutes before it expires, so a call
 * that starts just before the expiry does not race it.
 */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface RefreshedAccessToken {
  accessToken: string;
  expiresAt: Date;
}

/**
 * One OAuth provider whose access token we store and refresh. YouTube and
 * Dropbox differ only in these fields.
 */
export interface OAuthProvider<
  ENotAuthenticated,
  ERefreshFailed,
  EStore,
  RStore,
> {
  /** Used in the log line and the refresh error message, e.g. "YouTube". */
  name: string;
  tokenEndpoint: string;
  clientCredentials: Config.Config<{ clientId: string; clientSecret: string }>;
  getStoredTokens: Effect.Effect<StoredOAuthTokens | null, EStore, RStore>;
  saveAccessToken: (
    tokens: RefreshedAccessToken
  ) => Effect.Effect<unknown, EStore, RStore>;
  notAuthenticated: () => ENotAuthenticated;
  refreshFailed: (message: string) => ERefreshFailed;
}

const refreshAccessToken = <ERefreshFailed>(
  provider: Pick<
    OAuthProvider<unknown, ERefreshFailed, unknown, unknown>,
    "name" | "tokenEndpoint" | "clientCredentials" | "refreshFailed"
  >,
  refreshToken: string
) =>
  Effect.gen(function* () {
    const { clientId, clientSecret } = yield* provider.clientCredentials;

    const tokenResponse = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(provider.tokenEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });

        if (!response.ok) {
          const errorData = await response.text();
          throw new Error(
            `${provider.name} token refresh failed: ${errorData}`
          );
        }

        return response.json() as Promise<{
          access_token: string;
          expires_in: number;
          token_type: string;
        }>;
      },
      catch: (e) =>
        provider.refreshFailed(
          e instanceof Error
            ? e.message
            : `${provider.name} token refresh failed`
        ),
    });

    return {
      accessToken: tokenResponse.access_token,
      expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
    };
  }).pipe(Effect.withSpan(`refresh${provider.name}AccessToken`));

/**
 * Get a valid access token for `provider`, refreshing and saving it first if
 * it is expired or about to expire. Fails with `provider.notAuthenticated()`
 * when no tokens are stored, and `provider.refreshFailed(...)` when the token
 * endpoint refuses the refresh.
 */
export const getValidOAuthAccessToken = <
  ENotAuthenticated,
  ERefreshFailed,
  EStore,
  RStore,
>(
  provider: OAuthProvider<ENotAuthenticated, ERefreshFailed, EStore, RStore>
) =>
  Effect.gen(function* () {
    const stored = yield* provider.getStoredTokens;

    if (!stored) {
      return yield* Effect.fail(provider.notAuthenticated());
    }

    const isExpired =
      Date.now() >= stored.expiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS;

    if (!isExpired) {
      return stored.accessToken;
    }

    const refreshed = yield* refreshAccessToken(
      provider,
      stored.refreshToken
    ).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv()));

    yield* provider.saveAccessToken(refreshed);

    yield* Effect.logInfo(
      `${provider.name} access token refreshed successfully`
    );
    return refreshed.accessToken;
  });
