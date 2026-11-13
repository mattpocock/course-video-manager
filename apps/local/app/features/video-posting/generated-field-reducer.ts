/**
 * The flow every posting page shares for a text field the model can write:
 * generate the text, ask before it replaces text that is already there, then
 * apply it. A surface reducer keeps this state as one of its fields and hands
 * these actions to it (`postPageReducer`, `shortsPostingReducer`; batch 9 of
 * docs/plans/reducer-migration.md reuses it for the other posting pages).
 *
 * The field's text itself is the surface reducer's, so an event carries the
 * text as it was when the user acted, and the text is changed by declaring
 * `apply-field-text`, which the surface reducer applies to its own state. See
 * docs/FRONTEND_STATE.md.
 */
export namespace generatedFieldReducer {
  export interface State<TField extends string> {
    /** The field being generated. One at a time: both buttons wait on it. */
    generating: Generating<TField> | null;
    /** A new text waiting on Replace / Cancel, beside the text it replaces. */
    pendingOverwrite: PendingOverwrite<TField> | null;
  }

  export interface Generating<TField extends string> {
    field: TField;
    /** The field's text when Generate was pressed. */
    currentText: string;
    askToReplace: boolean;
  }

  export interface PendingOverwrite<TField extends string> {
    field: TField;
    currentText: string;
    pendingText: string;
  }

  export type Action<TField extends string, TRequest> =
    | {
        type: "generate-clicked";
        field: TField;
        currentText: string;
        /**
         * Ask before a generated text replaces non-blank text. `false` for a
         * field that has always been replaced straight away (the Shorts
         * modal's description).
         */
        askToReplace: boolean;
        request: TRequest;
      }
    | { type: "text-generated"; field: TField; text: string }
    | { type: "text-generation-failed"; field: TField }
    /** A ready-made text for the field, such as the Pitch's YouTube title. */
    | { type: "text-offered"; field: TField; currentText: string; text: string }
    | { type: "overwrite-confirmed" }
    | { type: "overwrite-cancelled" };

  export type Effect<TField extends string, TRequest> =
    | { type: "generate-text"; field: TField; request: TRequest }
    | { type: "apply-field-text"; field: TField; text: string };
}

export const createInitialGeneratedFieldState = <
  TField extends string,
>(): generatedFieldReducer.State<TField> => ({
  generating: null,
  pendingOverwrite: null,
});

const offer = <TField extends string>(
  state: generatedFieldReducer.State<TField>,
  offered: generatedFieldReducer.PendingOverwrite<TField>,
  askToReplace: boolean,
  exec: (effect: {
    type: "apply-field-text";
    field: TField;
    text: string;
  }) => void
): generatedFieldReducer.State<TField> => {
  if (askToReplace && offered.currentText.trim()) {
    return { ...state, pendingOverwrite: offered };
  }
  exec({
    type: "apply-field-text",
    field: offered.field,
    text: offered.pendingText,
  });
  return state;
};

export function generatedFieldReducer<TField extends string, TRequest>(
  state: generatedFieldReducer.State<TField>,
  action: generatedFieldReducer.Action<TField, TRequest>,
  exec: (effect: generatedFieldReducer.Effect<TField, TRequest>) => void
): generatedFieldReducer.State<TField> {
  switch (action.type) {
    case "generate-clicked":
      if (state.generating) return state;
      exec({
        type: "generate-text",
        field: action.field,
        request: action.request,
      });
      return {
        ...state,
        generating: {
          field: action.field,
          currentText: action.currentText,
          askToReplace: action.askToReplace,
        },
      };
    case "text-generated": {
      const { generating } = state;
      if (generating?.field !== action.field) return state;
      return offer(
        { ...state, generating: null },
        {
          field: action.field,
          currentText: generating.currentText,
          pendingText: action.text,
        },
        generating.askToReplace,
        exec
      );
    }
    case "text-generation-failed":
      if (state.generating?.field !== action.field) return state;
      return { ...state, generating: null };
    case "text-offered":
      return offer(
        state,
        {
          field: action.field,
          currentText: action.currentText,
          pendingText: action.text,
        },
        true,
        exec
      );
    case "overwrite-confirmed": {
      const { pendingOverwrite } = state;
      if (!pendingOverwrite) return state;
      exec({
        type: "apply-field-text",
        field: pendingOverwrite.field,
        text: pendingOverwrite.pendingText,
      });
      return { ...state, pendingOverwrite: null };
    }
    case "overwrite-cancelled":
      if (!state.pendingOverwrite) return state;
      return { ...state, pendingOverwrite: null };
  }
}
