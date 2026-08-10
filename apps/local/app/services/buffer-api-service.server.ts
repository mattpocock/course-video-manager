import { Data, Effect, Config } from "effect";

export class BufferApiError extends Data.TaggedError("BufferApiError")<{
  message: string;
}> {}

const BUFFER_API_URL = "https://api.buffer.com";

const graphql = (opts: {
  token: string;
  query: string;
  variables?: Record<string, unknown>;
}) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(BUFFER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.token}`,
        },
        body: JSON.stringify({
          query: opts.query,
          variables: opts.variables,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Buffer API ${res.status}: ${text}`);
      }

      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(
          `Buffer GraphQL: ${json.errors.map((e: { message: string }) => e.message).join(", ")}`
        );
      }

      return json.data;
    },
    catch: (e) =>
      new BufferApiError({
        message: e instanceof Error ? e.message : String(e),
      }),
  });

const createBufferApiOperations = (token: string) => ({
  createPost: (opts: { channelId: string; text: string; videoUrl: string }) =>
    graphql({
      token,
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
        return Effect.fail(
          new BufferApiError({
            message: `Buffer createPost failed: ${payload.message ?? "unknown error"}`,
          })
        );
      })
    ),
});

export class BufferApiService extends Effect.Service<BufferApiService>()(
  "BufferApiService",
  {
    effect: Effect.gen(function* () {
      const token = yield* Config.string("BUFFER_API_TOKEN");
      return createBufferApiOperations(token);
    }),
    dependencies: [],
  }
) {}
