import { useContext } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { useEffectReducer } from "use-effect-reducer";
import { UploadContext } from "@/features/upload-manager/upload-context";
import {
  createInitialPublishPageState,
  publishPageReducer,
} from "./publish-page-reducer";

/** The publish page's effect runner for `publishPageReducer`. */
export function usePublishPageReducer() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { startPublish, startAutofill } = useContext(UploadContext);

  const [state, dispatch] = useEffectReducer<
    publishPageReducer.State,
    publishPageReducer.Action,
    publishPageReducer.Effect
  >(publishPageReducer, createInitialPublishPageState, {
    "start-publish": (_state, effect) => {
      // The Autofill is its own Job, never a stage inside the Publish (ADR
      // 0024): the Publish waits on it and fails with it, so a model failure
      // can never strand a Pending Version. A Video it could not fill still
      // blocks, and the Publish is refused at validation, before Submit.
      const autofillJobId =
        effect.autofillVersionId === null
          ? undefined
          : startAutofill(
              effect.courseId,
              effect.courseName,
              effect.autofillVersionId,
              effect.includeTodoLessons
            );
      startPublish(
        effect.courseId,
        effect.courseName,
        effect.versionName,
        effect.description,
        effect.includeTodoLessons,
        effect.placeholders,
        autofillJobId
      );
    },
    "open-course": (_state, effect) => {
      navigate(`/courses/${effect.courseId}`);
    },
    "revalidate-readiness": () => {
      void revalidator.revalidate();
    },
  });

  return { state, dispatch };
}
