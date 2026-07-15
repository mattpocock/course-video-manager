import { createSSEResponse } from "@/lib/create-sse-response.server";
import { runtimeLive } from "@/services/layer.server";
import { bufferPostProgram } from "@/services/buffer-posting-orchestration.server";
import type { Route } from "./+types/api.videos.$videoId.post-social";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;
  const body = await args.request.json();
  const caption: string = body.caption;

  if (!caption) {
    return Response.json({ error: "Caption is required" }, { status: 400 });
  }

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) => bufferPostProgram({ videoId, caption, sendEvent }),
    errorHandlers: [
      {
        tag: "BufferApiError",
        handler: (e, sendEvent) => {
          sendEvent("error", { message: e.message });
        },
      },
      {
        tag: "VercelBlobError",
        handler: (e, sendEvent) => {
          sendEvent("error", { message: e.message });
        },
      },
    ],
    fallbackMessage: "Buffer posting failed unexpectedly",
  });
};
