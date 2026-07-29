import type { Route } from "./+types/api.diagram-component-thumbnails.$componentId";
import { readComponentThumbnail } from "@/services/diagram-thumbnail-store.server";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Components are immutable, so a thumbnail keyed by component id never needs
 * invalidating — hence the immutable cache header with no content hash in the
 * URL.
 */
export const loader = async (args: Route.LoaderArgs) => {
  const { componentId } = args.params;

  if (!SAFE_ID.test(componentId)) {
    return new Response("Bad request", { status: 400 });
  }

  const png = readComponentThumbnail(componentId);
  if (!png) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
