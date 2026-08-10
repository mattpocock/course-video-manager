import { lazy, Suspense, useCallback } from "react";
import type { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

let formatterRegistered = false;

const registerPrettierFormatter = (monaco: typeof Monaco) => {
  if (formatterRegistered) return;
  formatterRegistered = true;
  monaco.languages.registerDocumentFormattingEditProvider("markdown", {
    provideDocumentFormattingEdits: async (model: Monaco.editor.ITextModel) => {
      try {
        const [prettier, markdownPlugin] = await Promise.all([
          import("prettier/standalone"),
          import("prettier/plugins/markdown"),
        ]);
        const formatted = await prettier.format(model.getValue(), {
          parser: "markdown",
          plugins: [markdownPlugin.default],
          proseWrap: "preserve",
          tabWidth: 2,
        });
        return [
          {
            text: formatted,
            range: model.getFullModelRange(),
          },
        ];
      } catch {
        return [];
      }
    },
  });
};

export interface MarkdownMonacoEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the post-format value when the user presses Ctrl/Cmd+S. */
  onSave?: (value: string) => void;
  height?: string | number;
  editorRef?: React.MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>;
  onMount?: OnMount;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
  fallback?: React.ReactNode;
}

const DEFAULT_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  wordWrap: "on",
  lineNumbers: "off",
  fontSize: 14,
  padding: { top: 12, bottom: 12 },
  scrollBeyondLastLine: false,
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: false,
};

export function MarkdownMonacoEditor({
  value,
  onChange,
  onSave,
  height = "100%",
  editorRef,
  onMount,
  options,
  fallback,
}: MarkdownMonacoEditorProps) {
  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      if (editorRef) editorRef.current = editor;
      registerPrettierFormatter(monaco);

      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        async () => {
          const formatAction = editor.getAction("editor.action.formatDocument");
          if (formatAction) {
            await formatAction.run();
          }
          onSave?.(editor.getValue());
        }
      );

      onMount?.(editor, monaco);
    },
    [editorRef, onMount, onSave]
  );

  return (
    <Suspense
      fallback={
        fallback ?? (
          <div
            className="flex items-center justify-center text-muted-foreground text-sm"
            style={{ height }}
          >
            Loading editor…
          </div>
        )
      }
    >
      <MonacoEditor
        height={height}
        defaultLanguage="markdown"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleMount}
        theme="vs-dark"
        options={{ ...DEFAULT_OPTIONS, ...options }}
      />
    </Suspense>
  );
}
