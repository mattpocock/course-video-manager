import { domainServicesLayer, type DomainServices } from "@cvm/core/layer";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import { Layer, ManagedRuntime } from "effect";

/**
 * The runtime every request runs through.
 *
 * ONE of these, built at module scope, never disposed. A Fluid instance serves
 * many requests, so building a runtime per request would build a connection
 * pool per request; and because Effect memoizes layers by reference equality,
 * the layer has to come from a module (see `@cvm/core/layer`) rather than be
 * assembled here per call for that memoization to bite.
 *
 * Nothing calls `dispose()`. The instance is suspended by the platform, not
 * shut down by us, and Vercel's `attachDatabasePool` is what releases idle
 * clients before that happens.
 */
export type RemoteRuntime = ManagedRuntime.ManagedRuntime<
  DomainServices | DrizzleService,
  never
>;

/** The production layer: the domain services over a real Postgres pool. */
export const remoteLayer: Layer.Layer<DomainServices | DrizzleService> =
  domainServicesLayer.pipe(Layer.provideMerge(DrizzleService.Default));

export const remoteRuntime: RemoteRuntime = ManagedRuntime.make(remoteLayer);
