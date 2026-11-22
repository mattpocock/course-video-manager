export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const after = (ms: number, run: () => void): (() => void) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

export const every = (ms: number, run: () => void): (() => void) => {
  const id = setInterval(run, ms);
  return () => clearInterval(id);
};
