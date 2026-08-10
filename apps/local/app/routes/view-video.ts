import { createReadStream, statSync } from "fs";
import type { Route } from "./+types/view-video";

export const loader = async (args: Route.LoaderArgs) => {
  const request = args.request;
  const searchParams = new URL(request.url).searchParams;
  const videoPath = searchParams.get("videoPath");

  if (!videoPath) {
    return new Response("Missing videoPath on search params", {
      status: 400,
    });
  }

  try {
    const stat = statSync(videoPath);
    const fileSize = stat.size;

    const range = request.headers.get("range");

    if (range) {
      // Handle range requests for video seeking
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0]!, 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      const stream = createReadStream(videoPath, { start, end });

      return new Response(stream as any, {
        status: 206, // Partial Content
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize.toString(),
          "Content-Type": "video/mp4",
        },
      });
    } else {
      // Handle regular requests
      const stream = createReadStream(videoPath);

      return new Response(stream as any, {
        headers: {
          "Content-Length": fileSize.toString(),
          "Accept-Ranges": "bytes",
          "Content-Type": "video/mp4",
        },
      });
    }
  } catch (error) {
    return new Response(null, {
      status: 404,
    });
  }
};
