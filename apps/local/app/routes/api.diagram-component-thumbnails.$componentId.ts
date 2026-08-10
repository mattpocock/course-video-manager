import type { Route } from "./+types/api.diagram-component-thumbnails.$componentId";
import {
  isSafeSegment,
  readComponentThumbnail,
  thumbnailResponse,
} from "@/services/diagram-thumbnail-store.server";

/**
 * Components are immutable, so a thumbnail keyed by component id never needs
 * invalidating — hence the immutable cache header with no content hash in the
 * URL.
 */
export const loader = async (args: Route.LoaderArgs) => {
  const { componentId } = args.params;

  if (!isSafeSegment(componentId)) {
    return new Response("Bad request", { status: 400 });
  }

  return thumbnailResponse(readComponentThumbnail(componentId));
};
