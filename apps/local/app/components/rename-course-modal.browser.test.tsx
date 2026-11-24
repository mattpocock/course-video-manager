import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Toaster } from "@/components/ui/sonner";
import { httpRequest } from "@/packages/http";
import { RenameCourseModal } from "./rename-course-modal";

vi.mock("@/packages/http", () => ({ httpRequest: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderModal(onOpenChange: (open: boolean) => void) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <Toaster />
            <RenameCourseModal
              courseId="c1"
              currentName="Old Name"
              open
              onOpenChange={onOpenChange}
            />
          </>
        ),
      },
    ],
    { initialEntries: ["/"] }
  );
  return render(<RouterProvider router={router} />);
}

describe("RenameCourseModal", () => {
  it("closes once the action succeeds", async () => {
    vi.mocked(httpRequest).mockResolvedValue(Response.json({ success: true }));
    const onOpenChange = vi.fn();
    const screen = renderModal(onOpenChange);

    await screen.getByRole("button", { name: "Save" }).click();

    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [url] = vi.mocked(httpRequest).mock.calls[0] ?? [];
    expect(url).toBe("/api/courses/c1/rename-course");
  });

  it("stays open and toasts the action's own error when it fails", async () => {
    vi.mocked(httpRequest).mockResolvedValue(
      Response.json("A course with that name already exists", { status: 409 })
    );
    const onOpenChange = vi.fn();
    const screen = renderModal(onOpenChange);

    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByText("A course with that name already exists"))
      .toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();
    await expect.element(screen.getByText("Rename Course")).toBeVisible();
  });
});
