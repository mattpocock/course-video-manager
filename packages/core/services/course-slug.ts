import { toSlug } from "./lesson-path-service";

export const courseNameToSlug = (name: string): string => {
  return toSlug(name);
};
