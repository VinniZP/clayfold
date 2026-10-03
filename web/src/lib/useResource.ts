import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "./i18n";

export type Resource<T> = {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (update: (prev: T | undefined) => T | undefined) => void;
};

/** Loads `load()` whenever `key` changes; `reload` and a language switch refetch without clearing the current data. */
export function useResource<T>(load: () => Promise<T>, key: string | null): Resource<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(key !== null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const value = await loadRef.current();
      if (n !== seq.current) return;
      setDataState(value);
      setError(null);
    } catch (err) {
      if (n === seq.current) setError(err);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (key === null) {
      setLoading(false);
      return;
    }
    setDataState(undefined);
    setError(null);
    void run();
  }, [key, run]);

  // The server writes some labels in the current language; refetch them after a switch, keeping the shown data.
  const language = useLang();
  const loadedIn = useRef(language);
  useEffect(() => {
    if (loadedIn.current === language) return;
    loadedIn.current = language;
    if (key !== null) void run();
  }, [language, key, run]);

  const setData = useCallback((update: (prev: T | undefined) => T | undefined) => setDataState(update), []);
  return { data, error, loading, reload: run, setData };
}
