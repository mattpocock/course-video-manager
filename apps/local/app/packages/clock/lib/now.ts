export const now = (): Date => new Date();

export const nowMs = (): number => Date.now();

export const toDate = (value: string | number): Date => new Date(value);
