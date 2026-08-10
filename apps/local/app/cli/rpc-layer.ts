import { Layer } from "effect";
import {
  SearchOperationsService,
  type SearchParams,
} from "@/services/db-search-operations.server";
import { callRpc, makeRpcClient, type RpcClientConfig } from "./rpc-client";

/**
 * The CLI's transport layer: the domain services, backed by HTTP instead of a
 * Postgres connection.
 *
 * The services keep their existing TAGS, so no command handler knows or cares
 * that the work now happens on another machine — swapping the layer is the
 * whole change. As verb groups land on the API, they move from the in-process
 * layer in ./layer.ts to this one.
 *
 * THERE IS ONE TRANSPORT. The author's own `cvm` goes through here too. A
 * second in-process path for local use would be the path least exercised, on
 * the machine least watched.
 */
export const makeRemoteLayer = (
  config: RpcClientConfig
): Layer.Layer<SearchOperationsService> => {
  const client = makeRpcClient(config);

  // The service's declared failure channel is its in-process one
  // (UnknownDBServiceError); over HTTP it also carries AuthenticationError and
  // TransportError, and Effect's error channel does not widen on assignment.
  // The CLI renderer dispatches on `_tag` and handles any tag defensively, so
  // the mismatch is contained to this ONE cast rather than rippling through
  // every command signature — which is the price of the services keeping their
  // tags across the move to HTTP, and worth paying: no command handler changed.
  const search = {
    _tag: "SearchOperationsService",
    search: (params: SearchParams) =>
      callRpc(() =>
        client.rpc.search.search.$post({
          json: {
            root: params.root,
            query: params.query,
            types: [...params.types],
          },
        })
      ),
  } as unknown as SearchOperationsService;

  return Layer.succeed(SearchOperationsService, search);
};
