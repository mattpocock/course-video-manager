// @ts-ignore
export const explicitAny: any = 1;

export function nonNull(value: string | undefined): string {
  return value!;
}

declare const leak: any;

function takesString(value: string): string {
  return value;
}

export const unsafeArgument = takesString(leak);
export const unsafeAssignment: string = leak;
export const unsafeCall = leak();
export const unsafeMemberAccess = leak.field;

export function unsafeReturn(): string {
  return leak;
}
