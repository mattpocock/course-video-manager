import { Layer } from "effect";
import { ApiTokenOperationsService } from "./services/db-api-token-operations.server";
import { SearchOperationsService } from "./services/db-search-operations.server";

/**
 * Every domain service the RPC surface is allowed to expose, as ONE layer.
 *
 * It is exported from a module rather than built where it is used because
 * Effect memoizes layers by REFERENCE equality: a layer constructed per request
 * would open a fresh connection pool per request. There is exactly one of
 * these, and the deployed app's `ManagedRuntime` is built from it once.
 *
 * Growing this layer is how a verb group is added — see the `apps/remote`
 * router. Note what is NOT here and never will be: the YouTube, Dropbox and
 * AI Hero authentication rows have no service on this list, so no endpoint can
 * be written against them by accident.
 */
export const domainServicesLayer = Layer.mergeAll(
  ApiTokenOperationsService.Default,
  SearchOperationsService.Default
);

/** The services `domainServicesLayer` provides. */
export type DomainServices = Layer.Layer.Success<typeof domainServicesLayer>;
