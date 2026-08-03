import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

/**
 * Renders a component that reaches for router context (a `useFetcher`, a
 * `Link`) to static markup. A memory router with the component as its one route
 * is the cheapest way to give it that context.
 */
export function renderInRouter(element: ReactNode): string {
  return renderToStaticMarkup(
    <RouterProvider router={createMemoryRouter([{ path: "/", element }])} />
  );
}
