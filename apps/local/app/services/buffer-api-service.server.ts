import { Data, Effect, Config, Redacted } from "effect";

export class BufferApiError extends Data.TaggedError("BufferApiError")<{
  message: string;
  cause?: unknown;
  /**
   * Buffer answered and did not make the post: a 4xx, a GraphQL error or a
   * `MutationError`. Unset when it is unknown whether Buffer has it (no
   * answer, a 5xx).
   */
  refused?: boolean;
}> {}

/**
 * Buffer refused the API key itself: an HTTP 401, or a GraphQL error coded
 * `UNAUTHENTICATED`. Personal keys expire, so this is the failure an author
 * eventually meets, and the message says how to fix it rather than echoing
 * Buffer's "Access token is not valid".
 */
export class BufferAuthError extends Data.TaggedError("BufferAuthError")<{
  message: string;
}> {}

export const BUFFER_AUTH_ERROR_MESSAGE =
  "Buffer API key invalid or expired — create a new key at publish.buffer.com/settings/api, set BUFFER_API_TOKEN in the CVM root .env, then restart.";

const DEFAULT_BUFFER_API_URL = "https://api.buffer.com";

interface GraphQLErrorEntry {
  message?: string;
  extensions?: { code?: string };
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: GraphQLErrorEntry[];
}

/** What came back from Buffer, before we decide whether it is a failure. */
interface RawResponse {
  status: number;
  /** Already redacted: the token never survives into this string. */
  body: string;
}

const redact = (text: string, token: string) =>
  token === "" ? text : text.split(token).join("[REDACTED]");

const parseBody = (body: string): GraphQLResponse | undefined => {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as GraphQLResponse)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Log a failed Buffer call with its status and (redacted) body, then turn it
 * into a tagged error. The toast shows one line; the log keeps the rest.
 */
const failRequest = (opts: {
  operation: string;
  response: RawResponse;
  errors: GraphQLErrorEntry[];
}) => {
  const { status, body } = opts.response;
  const isAuthFailure =
    status === 401 ||
    opts.errors.some((e) => e.extensions?.code === "UNAUTHENTICATED");
  const ok = status >= 200 && status < 300;
  const detail =
    opts.errors.length > 0
      ? opts.errors.map((e) => e.message ?? "unknown error").join(", ")
      : body;

  const error = isAuthFailure
    ? new BufferAuthError({ message: BUFFER_AUTH_ERROR_MESSAGE })
    : new BufferApiError({
        message: ok
          ? `Buffer GraphQL: ${detail}`
          : `Buffer API ${status}: ${detail}`,
        refused: status < 500,
      });

  return Effect.logError(
    `Buffer API ${opts.operation} failed: HTTP ${status} — body: ${body}`
  ).pipe(Effect.zipRight(Effect.fail(error)));
};

const graphql = (opts: {
  url: string;
  token: Redacted.Redacted<string>;
  operation: string;
  query: string;
  variables?: Record<string, unknown>;
}) =>
  Effect.gen(function* () {
    const token = Redacted.value(opts.token);

    const response = yield* Effect.tryPromise({
      try: async (signal): Promise<RawResponse> => {
        const res = await fetch(opts.url, {
          signal,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query: opts.query,
            variables: opts.variables,
          }),
        });
        return { status: res.status, body: redact(await res.text(), token) };
      },
      catch: (e) =>
        new BufferApiError({
          message: `Buffer API ${opts.operation} request failed: ${redact(
            e instanceof Error ? e.message : String(e),
            token
          )}`,
          // A network failure (ECONNREFUSED, DNS); fetch never puts request
          // headers, so never the token, on it.
          cause: e,
        }),
    }).pipe(Effect.tapError((e) => Effect.logError(e.message)));

    const json = parseBody(response.body);
    const errors = json?.errors ?? [];
    const ok = response.status >= 200 && response.status < 300;

    if (!ok || errors.length > 0 || json?.data === undefined) {
      return yield* failRequest({
        operation: opts.operation,
        response,
        errors,
      });
    }

    return json.data;
  });

const createBufferApiOperations = (config: {
  url: string;
  token: Redacted.Redacted<string>;
}) => ({
  /**
   * A cheap `{ account { id } }` call, made before the video upload so a dead
   * key fails in seconds instead of after it. Fails only with
   * `BufferAuthError`. Anything else — a key without the `accountRead` scope,
   * a permission refusal, a transient error — means "could not check": it is
   * logged and posting goes ahead, because a key that cannot read the account
   * may still be allowed to post.
   */
  verifyAuth: () =>
    graphql({
      ...config,
      operation: "pre-flight",
      query: "{ account { id } }",
    }).pipe(
      Effect.asVoid,
      Effect.catchTag("BufferApiError", () =>
        Effect.logWarning(
          "Buffer pre-flight could not check the key; posting anyway"
        )
      )
    ),

  createPost: (opts: { channelId: string; text: string; videoUrl: string }) =>
    graphql({
      ...config,
      operation: "createPost",
      // `createPost` returns the `PostActionPayload` union, so the created post's
      // `id` lives behind the `PostActionSuccess` inline fragment; on failure the
      // `MutationError` fragment carries a human-readable message.
      query: `
        mutation CreatePost($input: CreatePostInput!) {
          createPost(input: $input) {
            ... on PostActionSuccess {
              post {
                id
              }
            }
            ... on MutationError {
              message
            }
          }
        }
      `,
      variables: {
        input: {
          channelId: opts.channelId,
          text: opts.text,
          assets: [{ video: { url: opts.videoUrl } }],
          schedulingType: "automatic",
          // `shareNow` publishes the post immediately instead of dropping it
          // into the channel's queue (`addToQueue`). Buffer downloads the video
          // asset asynchronously; there is no delivery confirmation, so once the
          // mutation succeeds the post is considered submitted.
          mode: "shareNow",
        },
      },
    }).pipe(
      Effect.flatMap((data) => {
        const payload = data.createPost as {
          post?: { id: string };
          message?: string;
        };
        if (payload.post?.id) {
          return Effect.succeed({ id: payload.post.id });
        }
        const message = `Buffer createPost failed: ${payload.message ?? "unknown error"}`;
        return Effect.logError(message).pipe(
          Effect.zipRight(
            Effect.fail(new BufferApiError({ message, refused: true }))
          )
        );
      })
    ),
});

export class BufferApiService extends Effect.Service<BufferApiService>()(
  "BufferApiService",
  {
    effect: Effect.gen(function* () {
      const token = yield* Config.redacted("BUFFER_API_TOKEN");
      // Overridable so a test or a verification run can point at a fake
      // endpoint; nothing sets it day to day.
      const url = yield* Config.string("BUFFER_API_URL").pipe(
        Config.withDefault(DEFAULT_BUFFER_API_URL)
      );
      return createBufferApiOperations({ url, token });
    }),
    dependencies: [],
  }
) {}
