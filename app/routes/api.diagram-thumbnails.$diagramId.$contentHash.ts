import type { Route } from "./+types/api.diagram-thumbnails.$diagramId.$contentHash";
import {
  isSafeSegment,
  readThumbnail,
  thumbnailResponse,
} from "@/services/diagram-thumbnail-store.server";

export const loader = async (args: Route.LoaderArgs) => {
  const { diagramId, contentHash } = args.params;

  if (!isSafeSegment(diagramId) || !isSafeSegment(contentHash)) {
    return new Response("Bad request", { status: 400 });
  }

  return thumbnailResponse(readThumbnail(diagramId, contentHash));
};
