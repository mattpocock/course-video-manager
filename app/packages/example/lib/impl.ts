// Internal implementation — hidden from outside the package.
// Lives in a subfolder (`lib/`), so nothing outside `example/` may import it.
// The entry point (`../index.ts`) is the only way to reach this behaviour.

export function shout(text: string): string {
  return `${text.trim().toUpperCase()}!`;
}
