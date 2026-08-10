import * as DomainErrors from "../services/db-service-errors";
import {
  AuthenticationError,
  ConfigurationError,
  SchemaVersionMismatchError,
  TransportError,
} from "./rpc-errors";

/**
 * The wire format the deployed API answers in, and the CLI reads.
 *
 * An RPC call is one Effect run on the far side of a network. So the envelope
 * is just the two channels of an Effect: a success value, or a TAGGED failure.
 * The tag is the whole point — a `NotFoundError` raised in a service has to
 * arrive at the CLI as a `NotFoundError`, so `Effect.flip` and `_tag`
 * assertions behave exactly as they did when the service ran in-process.
 */

export interface RpcErrorPayload {
  readonly _tag: string;
  readonly [key: string]: unknown;
}

export type RpcSuccess<A> = { readonly ok: true; readonly value: A };
export type RpcFailure = {
  readonly ok: false;
  readonly error: RpcErrorPayload;
};
export type RpcResponse<A> = RpcSuccess<A> | RpcFailure;

/**
 * Every tagged error that may cross the wire, keyed by its tag.
 *
 * A tag missing from here still round-trips (see `decodeRpcError`) — it just
 * arrives as a plain tagged object rather than an instance. Adding a class here
 * is what makes `instanceof` work on the CLI side.
 */
const ERROR_CONSTRUCTORS: Record<
  string,
  new (props: never) => { readonly _tag: string }
> = {
  AuthenticationError,
  TransportError,
  ConfigurationError,
  SchemaVersionMismatchError,
  NotFoundError: DomainErrors.NotFoundError,
  UnknownDBServiceError: DomainErrors.UnknownDBServiceError,
  NotLatestVersionError: DomainErrors.NotLatestVersionError,
  CannotUpdatePublishedVersionError:
    DomainErrors.CannotUpdatePublishedVersionError,
  VersionNotDraftError: DomainErrors.VersionNotDraftError,
  VersionNotPendingError: DomainErrors.VersionNotPendingError,
  PendingVersionExistsError: DomainErrors.PendingVersionExistsError,
  CannotArchiveLessonVideoError: DomainErrors.CannotArchiveLessonVideoError,
  CourseNameTakenError: DomainErrors.CourseNameTakenError,
  SectionPathTakenError: DomainErrors.SectionPathTakenError,
  LessonPathTakenError: DomainErrors.LessonPathTakenError,
  VideoTitleTakenError: DomainErrors.VideoTitleTakenError,
  ClipNotZoomableError: DomainErrors.ClipNotZoomableError,
};

/**
 * Properties that must never be encoded.
 *
 * `cause` is the one that matters: `UnknownDBServiceError` wraps whatever the
 * driver threw, and a Postgres error carries the failing statement — sometimes
 * with the values in it. That belongs in the deployed app's logs, not in a
 * response body.
 */
const NEVER_ENCODED = new Set(["cause", "stack"]);

const tagOf = (error: unknown): string | undefined =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof (error as { _tag: unknown })._tag === "string"
    ? (error as { _tag: string })._tag
    : undefined;

/**
 * Flatten a tagged error into something JSON can carry.
 *
 * Only OWN ENUMERABLE properties are taken. That is not an implementation
 * detail — it is what keeps `VersionNotDraftError` working. Its message is a
 * prototype getter with no setter, so encoding it would produce a payload that
 * throws on the way back in; leaving it out lets the rebuilt error regenerate
 * the same message from the same getter.
 */
export const encodeRpcError = (error: unknown): RpcErrorPayload => {
  const tag = tagOf(error);
  if (tag === undefined) {
    return {
      _tag: "UnknownDBServiceError",
      message: "internal server error",
    };
  }

  const payload: Record<string, unknown> = { _tag: tag };
  for (const [key, value] of Object.entries(error as object)) {
    if (key === "_tag" || NEVER_ENCODED.has(key)) continue;
    if (value === undefined || typeof value === "function") continue;
    payload[key] = value;
  }

  // `message` needs asking for by name. These errors extend Error, which makes
  // an assigned message a non-enumerable OWN property — invisible to
  // Object.entries. The own-property check is what keeps the getter case out:
  // an error whose message is COMPUTED (VersionNotDraftError) has no own
  // message, so it is not encoded and the rebuilt error recomputes it.
  const own = Object.getOwnPropertyDescriptor(error as object, "message");
  if (typeof own?.value === "string") payload.message = own.value;

  return payload as RpcErrorPayload;
};

/**
 * Rebuild a payload as the tagged error it was raised as.
 *
 * An unrecognised tag is NOT an error: it comes back as a frozen plain object
 * that still carries `_tag` and its fields, so a CLI built before a new error
 * type existed still renders it correctly and still exits on the right code.
 */
export const decodeRpcError = (
  payload: RpcErrorPayload
): { readonly _tag: string } => {
  const { _tag, ...props } = payload;
  const Constructor = ERROR_CONSTRUCTORS[_tag];
  if (Constructor === undefined) return Object.freeze({ _tag, ...props });
  try {
    return new Constructor(props as never);
  } catch {
    // A payload from a NEWER deploy carrying a field this CLI's version of the
    // class refuses. The tag and the fields still matter more than the class,
    // so fall back rather than turn a domain error into a crash.
    return Object.freeze({ _tag, ...props });
  }
};

export const isRpcFailure = (body: unknown): body is RpcFailure =>
  typeof body === "object" &&
  body !== null &&
  (body as { ok?: unknown }).ok === false &&
  typeof (body as { error?: unknown }).error === "object";
