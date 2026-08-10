export function shouldIgnoreKeyboardShortcut(e: KeyboardEvent): boolean {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    (e.target instanceof HTMLButtonElement &&
      !e.target.classList.contains("allow-keydown"))
  ) {
    return true;
  }

  const target = e.target as (Element & { isContentEditable?: boolean }) | null;

  // Monaco 0.55 types into an EditContext-backed contenteditable div rather than
  // a hidden textarea, so an inline script edit reaches us as a plain element.
  if (target?.isContentEditable || target?.closest?.(".monaco-editor")) {
    return true;
  }

  if (target?.closest?.('[role="dialog"]')) {
    return true;
  }

  return false;
}
