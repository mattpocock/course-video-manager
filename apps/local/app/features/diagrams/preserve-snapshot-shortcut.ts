import { useEffect } from "react";

function isPreserveSnapshotShortcut(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  key: string;
}): boolean {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
}

export function usePreserveSnapshotShortcut(onSave: (() => void) | null) {
  useEffect(() => {
    if (!onSave) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPreserveSnapshotShortcut(e)) {
        e.preventDefault();
        onSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSave]);
}
