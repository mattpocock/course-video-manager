import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * A diagram containing a shape type this build does not understand fails schema
 * validation with a throw, and tldraw's loader takes the whole document with
 * it. Without a boundary that presents as a white screen — a state that is
 * neither diagnosable nor recoverable from inside the app.
 *
 * Two flavours, because the two render surfaces want opposite things:
 *   - the playground editor wants a legible message,
 *   - a thumbnail wants to disappear (a missing thumbnail is nothing; a crashed
 *     Playground Home is a lot).
 */
export class ShapeTypeErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Diagram render failed", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The playground editor's boundary: a legible message, never a white screen. */
export function DiagramEditorBoundary({ children }: { children: ReactNode }) {
  return (
    <ShapeTypeErrorBoundary fallback={<UnknownShapeNotice />}>
      {children}
    </ShapeTypeErrorBoundary>
  );
}

function UnknownShapeNotice() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-950 p-8 text-center">
      <p className="text-sm font-medium text-zinc-200">
        This diagram uses a shape this build doesn&apos;t know about.
      </p>
      <p className="max-w-md text-xs text-zinc-400">
        It was saved by a newer version of the app. Nothing has been lost —
        update and reopen it.
      </p>
    </div>
  );
}
