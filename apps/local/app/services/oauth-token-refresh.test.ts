import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Config, Data, Effect, Either } from "effect";
import {
  getValidOAuthAccessToken,
  type StoredOAuthTokens,
} from "@/services/oauth-token-refresh";

class NotAuthenticated extends Data.TaggedError("NotAuthenticated")<{}> {}
class RefreshFailed extends Data.TaggedError("RefreshFailed")<{
  message: string;
}> {}

const TOKEN_ENDPOINT = "https://oauth.example.test/token";
const MINUTE = 60 * 1000;

/** A provider over an in-memory token store. */
const makeProvider = (initial: StoredOAuthTokens | null) => {
  const store = { tokens: initial };
  const provider = {
    name: "Example",
    tokenEndpoint: TOKEN_ENDPOINT,
    clientCredentials: Config.succeed({
      clientId: "client-id",
      clientSecret: "client-secret",
    }),
    getStoredTokens: Effect.sync(() => store.tokens),
    saveAccessToken: (tokens: { accessToken: string; expiresAt: Date }) =>
      Effect.sync(() => {
        store.tokens = { ...store.tokens!, ...tokens };
      }),
    notAuthenticated: () => new NotAuthenticated(),
    refreshFailed: (message: string) => new RefreshFailed({ message }),
  };
  return { store, provider };
};

const run = (provider: ReturnType<typeof makeProvider>["provider"]) =>
  Effect.runPromise(Effect.either(getValidOAuthAccessToken(provider)));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("getValidOAuthAccessToken", () => {
  it("returns the stored token when it is not near expiry", async () => {
    const { provider } = makeProvider({
      accessToken: "stored",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 60 * MINUTE),
    });

    expect(await run(provider)).toEqual(Either.right("stored"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a token that expires within five minutes, and saves the new one", async () => {
    const { provider, store } = makeProvider({
      accessToken: "stale",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 4 * MINUTE),
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "fresh",
          expires_in: 3600,
          token_type: "Bearer",
        })
      )
    );

    expect(await run(provider)).toEqual(Either.right("fresh"));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(Object.fromEntries(init!.body as URLSearchParams)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh",
      client_id: "client-id",
      client_secret: "client-secret",
    });
    expect(store.tokens?.accessToken).toBe("fresh");
    expect(store.tokens!.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 59 * MINUTE
    );
  });

  it("fails with the provider's not-authenticated error when nothing is stored", async () => {
    const { provider } = makeProvider(null);

    expect(await run(provider)).toEqual(Either.left(new NotAuthenticated()));
  });

  it("fails with the provider's refresh error when the endpoint refuses", async () => {
    const { provider, store } = makeProvider({
      accessToken: "stale",
      refreshToken: "revoked",
      expiresAt: new Date(Date.now() - MINUTE),
    });
    fetchMock.mockResolvedValue(new Response("invalid_grant", { status: 400 }));

    expect(await run(provider)).toEqual(
      Either.left(
        new RefreshFailed({
          message: "Example token refresh failed: invalid_grant",
        })
      )
    );
    expect(store.tokens?.accessToken).toBe("stale");
  });
});
