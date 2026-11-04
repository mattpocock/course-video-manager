import { isRouteErrorResponse } from "react-router";

/**
 * What the app's error page says for a thrown route error. A status other
 * than 404 and 500 shows the message the route answered with — a 503 names
 * the Offline drive, or the command that applies a pending migration — since
 * `data(message, { status })` reaches the browser with no `statusText`.
 */
export function errorBoundaryCopy(error: unknown): {
  status: number;
  title: string;
  description: string;
} {
  const fallback = "An unexpected error occurred. Please try again.";
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        status: 404,
        title: "Page not found",
        description:
          "The page you're looking for doesn't exist or has been moved.",
      };
    }
    if (error.status === 500) {
      return {
        status: 500,
        title: "Server error",
        description: "Something went wrong on our end. Please try again later.",
      };
    }
    const answered =
      typeof error.data === "string" && error.data !== "" ? error.data : "";
    return {
      status: error.status,
      title: `Error ${error.status}`,
      description: answered || error.statusText || fallback,
    };
  }
  if (error instanceof Error) {
    return {
      status: 500,
      title: "Something went wrong",
      description: error.message,
    };
  }
  return { status: 500, title: "Something went wrong", description: fallback };
}
