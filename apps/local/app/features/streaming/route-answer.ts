import { Either, Schema } from "effect";
import type { UnlistResult } from "./broadcast";

/**
 * Reading what the app server's streaming routes answered: the reason a
 * route refused with, and End Stream's answer. Shared by the Live Stream and
 * New Broadcast effect runners.
 */

/** The reason a route refused with: its message, a JSON string or plain text. */
export const reasonOf = (body: string) => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "string") return parsed;
  } catch {
    // Plain text: the reason as it is.
  }
  return body;
};

export const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

const UnlistResultSchema = Schema.Union(
  Schema.Struct({ status: Schema.Literal("not-asked") }),
  Schema.Struct({ status: Schema.Literal("unlisted") }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String })
) satisfies Schema.Schema<UnlistResult, UnlistResult>;

const EndStreamAnswer = Schema.Struct({ unlist: UnlistResultSchema });

/**
 * How End Stream's unlist went, from the end-stream route's JSON answer.
 * Throws with a clear reason when the answer is not one.
 */
export const unlistOfEndStreamAnswer = (json: unknown): UnlistResult => {
  const decoded = Schema.decodeUnknownEither(EndStreamAnswer)(json);
  if (Either.isLeft(decoded)) {
    throw new Error(
      "The stream ended, but CVM could not read whether the Broadcast was unlisted."
    );
  }
  return decoded.right.unlist;
};
