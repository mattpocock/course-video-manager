import type { Route } from "./+types/api.courses.$courseId.delete-version";

export const action = async (_args: Route.ActionArgs) => {
  return {
    success: false,
    error:
      "Deleting versions is no longer supported. Published versions are immutable and the draft cannot be deleted.",
  };
};
