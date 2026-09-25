import type { Route } from "./+types/view-image";
import { webFileStream } from "@/services/web-file-stream.server";

export const loader = async (args: Route.LoaderArgs) => {
  const request = args.request;
  const searchParams = new URL(request.url).searchParams;
  const imagePath = searchParams.get("imagePath");

  if (!imagePath) {
    return new Response("Missing imagePath on search params", {
      status: 400,
    });
  }

  try {
    return new Response(webFileStream(imagePath), {
      headers: {
        "Content-Type": "image/png",
      },
    });
  } catch (error) {
    return new Response(null, {
      status: 404,
    });
  }
};
