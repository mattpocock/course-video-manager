/**
 * Calls `onChanged` whenever `busy()` has changed since it was last asked
 * (`note`): it starts not busy. The service's busy is a take recording, a
 * Live Stream on, or a stopped take still closing its files; the service
 * process logs each change for `scripts/is-filming.sh`.
 */
export const watchBusy = (
  busy: () => boolean,
  onChanged: ((busy: boolean) => void) | undefined
) => {
  let was = false;
  return () => {
    const now = busy();
    if (now === was) return;
    was = now;
    onChanged?.(now);
  };
};
