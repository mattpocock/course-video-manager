import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import type { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialMarkdownEditorSyncState,
  markdownEditorSyncReducer,
} from "./markdown-editor-sync-reducer";

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
  // Monaco owns its text: it gets `value` once, as its default, and a later
  // `value` reaches it only when the sync reducer says it is not a lagging
  // echo of the user's own typing. Passing `value` straight through let
  // @monaco-editor/react overwrite fresh keystrokes with a stale round-trip.
  const ownEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const replacingTextRef = useRef(false);

  const [, dispatch] = useEffectReducer<
    markdownEditorSyncReducer.State,
    markdownEditorSyncReducer.Action,
    markdownEditorSyncReducer.Effect
  >(markdownEditorSyncReducer, createInitialMarkdownEditorSyncState, {
    "replace-text": (_state, effect) => {
      const editor = ownEditorRef.current;
      const model = editor?.getModel();
      if (!editor || !model || model.getValue() === effect.text) return;
      replacingTextRef.current = true;
      try {
        if (editor.getRawOptions().readOnly) {
          editor.setValue(effect.text);
        } else {
          editor.executeEdits("", [
            {
              range: model.getFullModelRange(),
              text: effect.text,
              forceMoveMarkers: true,
            },
          ]);
          editor.pushUndoStop();
        }
      } finally {
        replacingTextRef.current = false;
      }
    },
  });

  useEffect(() => {
    const editor = ownEditorRef.current;
    if (!editor) return;
    dispatch({
      type: "value-prop-received",
      value,
      modelValue: editor.getValue(),
    });
  }, [value, dispatch]);

  const handleChange = useCallback(
    (next: string | undefined) => {
      if (replacingTextRef.current) return;
      const text = next ?? "";
      dispatch({ type: "editor-content-changed", value: text });
      onChange(text);
    },
    [dispatch, onChange]
  );

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      ownEditorRef.current = editor;
      if (editorRef) editorRef.current = editor;
      // A `value` that changed while the editor was loading.
      dispatch({
        type: "value-prop-received",
        value: valueRef.current,
        modelValue: editor.getValue(),
      });
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
    [editorRef, onMount, onSave, dispatch]
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
        defaultValue={value}
        onChange={handleChange}
        onMount={handleMount}
        theme="vs-dark"
        options={{ ...DEFAULT_OPTIONS, ...options }}
      />
    </Suspense>
  );
}
