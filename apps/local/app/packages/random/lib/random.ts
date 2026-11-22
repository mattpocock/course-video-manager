export const randomFraction = (): number => Math.random();

export const randomInt = (bound: number): number => {
  if (!Number.isInteger(bound) || bound < 1) {
    throw new RangeError(
      `randomInt needs a positive whole bound, got ${bound}`
    );
  }
  return Math.floor(Math.random() * bound);
};
