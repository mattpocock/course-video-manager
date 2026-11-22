export const log = {
  debug: (...values: readonly unknown[]): void => console.debug(...values),
  info: (...values: readonly unknown[]): void => console.info(...values),
  warn: (...values: readonly unknown[]): void => console.warn(...values),
  error: (...values: readonly unknown[]): void => console.error(...values),
};
