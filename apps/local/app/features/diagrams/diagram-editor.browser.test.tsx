import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react/pure";
import { page, userEvent } from "@vitest/browser/context";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { Editor, TLShapeId } from "tldraw";
import { DiagramEditor } from "./diagram-editor";
import { PlaygroundStatusProvider } from "./playground-status";
import type { PaletteHandlers } from "./palette/use-palette";

/**
 * The shared Diagram Editor is what makes the thumbnail editor "the same
 * editor" as the Diagram Playground. These tests pin the two things a host
 * gets from it without asking: the vector-and-text-only rule, and the command
 * palette.
 */

const reported: string[] = [];
const status = {
  reportError: (message: string) => reported.push(message),
  reportSuccess: () => {},
};

const noop = () => {};
const handlers: PaletteHandlers = {
  onPreserveSnapshot: noop,
  onRestoreToHead: noop,
  onCopyContents: noop,
  onRenameDiagram: noop,
  onNewDiagram: noop,
  onRecentreDiagram: noop,
  onGoToDiagram: noop,
};

let editor: Editor;

// ONE editor for the file, never unmounted (`/pure` has no auto-cleanup):
// tldraw loads fonts in the background, and an editor disposed mid-load
// throws from inside tldraw.
beforeAll(async () => {
  editor = await new Promise<Editor>((resolve) => {
    const router = createMemoryRouter(
      [
        {
          // The licence key comes from the root loader, as in the app.
          id: "root",
          path: "/",
          loader: () => ({ tldrawLicenseKey: undefined }),
          HydrateFallback: () => null,
          element: (
            <PlaygroundStatusProvider value={status}>
              <div style={{ position: "fixed", inset: 0 }}>
                <DiagramEditor onMount={resolve} paletteHandlers={handlers} />
              </div>
            </PlaygroundStatusProvider>
          ),
        },
      ],
      {
        hydrationData: {
          loaderData: { root: { tldrawLicenseKey: undefined } },
        },
      }
    );
    render(<RouterProvider router={router} />);
  });
});

beforeEach(() => {
  reported.length = 0;
});

describe("the shared Diagram Editor", () => {
  it("refuses a pasted image and says why", async () => {
    const before = editor.getCurrentPageShapeIds().size;
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
      type: "image/png",
    });

    await editor.putExternalContent({
      type: "files",
      files: [png],
      point: { x: 0, y: 0 },
    });

    expect(editor.getCurrentPageShapeIds().size).toBe(before);
    expect(reported).toEqual([
      "Images, videos, and embeds aren't supported. Only vector shapes and text are allowed.",
    ]);
  });

  it("knows the CVM shapes", () => {
    editor.createShape({
      id: "shape:bot" as TLShapeId,
      type: "cvm-icon",
      x: 0,
      y: 0,
    });

    expect(editor.getShape("shape:bot" as TLShapeId)?.type).toBe("cvm-icon");
  });

  it("opens the command palette on Cmd+K", async () => {
    await userEvent.keyboard("{Control>}k{/Control}");

    await expect
      .element(page.getByRole("option", { name: /Insert icon/ }))
      .toBeVisible();
  });
});
