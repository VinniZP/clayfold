import { useEffect, useState } from "react";

/** "m:ss" (or "h:mm:ss") since `since`; re-renders once a second while `since` is set. */
export function useElapsed(since: string | number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (since === null) return null;
  const start = typeof since === "number" ? since : new Date(since).getTime();
  if (Number.isNaN(start)) return null;
  return formatElapsed(Math.max(0, now - start));
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
