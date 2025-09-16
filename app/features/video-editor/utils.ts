import { useEffect, useState } from "react";

export const useDebounceIdStore = (
  fn: (ids: string[]) => Promise<void>,
  delay: number
) => {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (ids.length === 0) return;
    const timeout = setTimeout(async () => {
      await fn([...new Set(ids)]);

      setIds([]);
    }, delay);
    return () => clearTimeout(timeout);
  }, [ids]);

  return (ids: string[]) => {
    setIds((prev) => [...prev, ...ids]);
  };
};

export type Brand<T, B extends string> = T & { __brand: B };
