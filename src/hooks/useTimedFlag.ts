import { useEffect, useRef, useState } from "react";

export function useTimedFlag(durationMs = 3000) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const trigger = (key: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setActiveKey(key);
    timeoutRef.current = setTimeout(() => setActiveKey(null), durationMs);
  };

  return { activeKey, trigger };
}
