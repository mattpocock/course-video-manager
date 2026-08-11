import { toSlug } from "./lesson-path-service.js";

export const courseNameToSlug = (name: string): string => {
  return toSlug(name);
};
