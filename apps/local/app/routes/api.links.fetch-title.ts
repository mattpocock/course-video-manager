import { data } from "react-router";
import type { Route } from "./+types/api.links.fetch-title";

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const url = formData.get("url");

  if (!url || typeof url !== "string") {
    throw data("URL is required", { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    throw data("Invalid URL format", { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)",
      },
      signal: AbortSignal.timeout(5000),
    });

    const html = await response.text();

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? null;

    return { title };
  } catch {
    return { title: null };
  }
};
