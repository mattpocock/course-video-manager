import { Data } from "effect";

/**
 * Failures that belong to the TRANSPORT, not the domain.
 *
 * They carry their own tags precisely so the CLI can tell "your token expired"
 * from "that Video does not exist" — the two are fixed by completely different
 * actions, and an agent that confuses them retries forever.
 */

/**
 * The API refused the request's credentials. The message deliberately does not
 * say WHETHER the token was unknown, expired or revoked — the deployed app is
 * the only thing that knows, and telling the caller would turn the endpoint
 * into an oracle for probing valid tokens.
 */
export class AuthenticationError extends Data.TaggedError(
  "AuthenticationError"
)<{
  readonly message: string;
}> {}

/** The API could not be reached, or answered with something unreadable. */
export class TransportError extends Data.TaggedError("TransportError")<{
  readonly message: string;
}> {}

/** The CLI has no API base URL / token to work with. */
export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly message: string;
}> {}

/** The single message every authentication failure answers with. */
export const AUTHENTICATION_FAILED_MESSAGE =
  "the API rejected this token — mint a new one in the Course Video Manager UI and put it on this box as CVM_API_TOKEN";
