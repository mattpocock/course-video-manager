export function overloaded(a: string): string;
export function overloaded(a: number): number;
export function overloaded(a: string | number): string | number {
  return a;
}
