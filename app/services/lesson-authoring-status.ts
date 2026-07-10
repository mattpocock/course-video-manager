export const AUTHORING_STATUSES = ["todo", "done"] as const;

export type AuthoringStatus = (typeof AUTHORING_STATUSES)[number];
